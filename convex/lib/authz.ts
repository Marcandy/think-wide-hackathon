import {
	compareRevision,
	may,
	type Principal,
	principalFromIdentity,
	type ResourceKind,
} from "../../core";
import { OPERATIONS, type OperationId } from "../../generated/operations";
import type {
	Decision,
	Investigation,
	ReadInvestigationRequest,
	Run,
	SourceRef,
} from "../../generated/types";
import * as validators from "../../generated/validators.js";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { decode, fail } from "./validation";

export async function requirePrincipal(
	ctx: Pick<QueryCtx, "auth">,
): Promise<Principal> {
	const principal = principalFromIdentity(await ctx.auth.getUserIdentity());
	return principal ?? fail("unauthenticated", "Authentication required");
}

export async function requireAccess(
	ctx: QueryCtx,
	principal: Principal,
	resourceKind: ResourceKind,
	resourceId: string,
	action: OperationId,
): Promise<Doc<"grants">> {
	const grants = await ctx.db
		.query("grants")
		.withIndex("by_principal_resource", (q) =>
			q
				.eq("principal", principal.id)
				.eq("resourceKind", resourceKind)
				.eq("resourceId", resourceId),
		)
		.collect();
	const grant = grants.find(
		(candidate) =>
			may(principal, action, { kind: resourceKind, id: resourceId }, [
				candidate,
			]) === "allow",
	);
	return grant ?? fail("not_found", "Resource not found");
}

const OWNED_ACTIONS = OPERATIONS.filter((operation) =>
	[
		"openInvestigation",
		"readInvestigation",
		"recordDecision",
		"requestAnalysis",
		"getRun",
		"cancelRun",
	].includes(operation.operationId),
).map((operation) => operation.operationId);

type ProtectedDocs = {
	investigation: Doc<"investigations">;
	decision: Doc<"decisions">;
	run: Doc<"runs">;
};
type Fence = Doc<"runs">["fences"][number];

/** This capability exposes no raw database, auth, scheduler, or service credentials. */
export class AuthorizedCtx {
	readonly principal: Principal;
	readonly operationId: OperationId;
	#ctx: QueryCtx;
	#fences = new Map<string, Fence>();

	constructor(ctx: QueryCtx, principal: Principal, operationId: OperationId) {
		this.#ctx = ctx;
		this.principal = principal;
		this.operationId = operationId;
	}

	async requireAccess(kind: ResourceKind, id: string): Promise<void> {
		const grant = await requireAccess(
			this.#ctx,
			this.principal,
			kind,
			id,
			this.operationId,
		);
		this.#fences.set(grant._id, { grantId: grant._id, epoch: grant.epoch });
	}

	fences(): Fence[] {
		return [...this.#fences.values()].sort((a, b) =>
			a.grantId.localeCompare(b.grantId),
		);
	}

	async loadAuthorized<K extends keyof ProtectedDocs>(
		kind: K,
		id: string,
	): Promise<ProtectedDocs[K]>;
	async loadAuthorized(
		kind: keyof ProtectedDocs,
		id: string,
	): Promise<ProtectedDocs[keyof ProtectedDocs]> {
		// The grant query is the same for missing and forbidden; content is never read first.
		await this.requireAccess(kind, id);
		if (kind === "investigation") {
			const normalized = this.#ctx.db.normalizeId("investigations", id);
			const row = normalized && (await this.#ctx.db.get(normalized));
			if (!row) return fail("not_found", "Resource not found");
			const value = decode<Investigation>(validators.Investigation, row.body);
			for (const snapshotId of value.snapshotIds)
				await this.requireAccess("snapshot", snapshotId);
			return row;
		}
		if (kind === "decision") {
			const normalized = this.#ctx.db.normalizeId("decisions", id);
			const row = normalized && (await this.#ctx.db.get(normalized));
			if (!row) return fail("not_found", "Resource not found");
			const parent = await this.loadAuthorized(
				"investigation",
				row.investigationId,
			);
			const value = decode<Decision>(validators.Decision, row.body);
			await this.authorizeDecision(
				value,
				decode<Investigation>(validators.Investigation, parent.body),
			);
			return row;
		}
		const normalized = this.#ctx.db.normalizeId("runs", id);
		const row = normalized && (await this.#ctx.db.get(normalized));
		if (!row) return fail("not_found", "Resource not found");
		await this.loadAuthorized("investigation", row.investigationId);
		// Run status is private to every input consumed at admission, including
		// decisions and entry grants that are narrower than the snapshot grant.
		for (const fence of row.fences) {
			const grant = await this.#ctx.db.get(fence.grantId);
			if (!grant || grant.revokedAt !== undefined)
				fail("not_found", "Resource not found");
			await this.requireAccess(grant.resourceKind, grant.resourceId);
		}
		return row;
	}

	async authorizeRefs(
		refs: readonly SourceRef[],
		investigation: Investigation,
	): Promise<void> {
		for (const ref of refs) {
			await this.requireAccess("repository", ref.repositoryId);
			if (!ref.snapshotId)
				fail(
					"source_unavailable",
					"Snapshot binding required for source reference",
				);
			await this.requireAccess("snapshot", ref.snapshotId);
			await this.requireAccess("entry", ref.entryId);
			if (!investigation.snapshotIds.includes(ref.snapshotId))
				fail("not_found", "Resource not found");
			if (
				ref.byteRange.end < ref.byteRange.start ||
				(ref.lineRange && ref.lineRange.end < ref.lineRange.start) ||
				ref.commit.length !== (ref.hashAlgorithm === "sha1" ? 40 : 64) ||
				ref.blobId.length !== (ref.hashAlgorithm === "sha1" ? 40 : 64)
			)
				fail("invalid_request", "Invalid source range or hash algorithm", {
					details: [
						{
							path: "/refs",
							problem: "Invalid source range or hash algorithm",
						},
					],
				});
		}
	}

	async authorizeDecision(
		decision: Pick<Decision, "refs" | "targetFindingId">,
		investigation: Investigation,
	): Promise<void> {
		if (decision.targetFindingId) {
			await this.requireAccess("finding", decision.targetFindingId);
			const finding = investigation.acceptedFindings?.find(
				(candidate) => candidate.findingId === decision.targetFindingId,
			);
			if (!finding) fail("not_found", "Resource not found");
			await this.authorizeRefs(finding.refs, investigation);
		}
		await this.authorizeRefs(decision.refs ?? [], investigation);
	}

	async investigation(id: string): Promise<Investigation> {
		return decode<Investigation>(
			validators.Investigation,
			(await this.loadAuthorized("investigation", id)).body,
		);
	}

	async decision(id: string): Promise<Decision> {
		return decode<Decision>(
			validators.Decision,
			(await this.loadAuthorized("decision", id)).body,
		);
	}

	async run(id: string): Promise<Run> {
		return decode<Run>(
			validators.Run,
			(await this.loadAuthorized("run", id)).body,
		);
	}

	/** Scope is authorized before the indexed page is read; every returned child is checked. */
	async queryAuthorized(
		investigationId: string,
		after: number,
		maximum: number,
	): Promise<Decision[]> {
		const parent = await this.loadAuthorized("investigation", investigationId);
		const rows = await this.#ctx.db
			.query("decisions")
			.withIndex("by_investigation_revision", (q) =>
				q.eq("investigationId", parent._id).gt("resultingRevision", after),
			)
			.take(maximum);
		const result: Decision[] = [];
		for (const row of rows) result.push(await this.decision(row._id));
		return result;
	}

	async readInvestigation(
		request: ReadInvestigationRequest,
	): Promise<Investigation> {
		const row = await this.loadAuthorized(
			"investigation",
			request.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			row.body,
		);
		for (const finding of investigation.acceptedFindings ?? []) {
			await this.requireAccess("finding", finding.findingId);
			await this.authorizeRefs(finding.refs, investigation);
		}
		if (investigation.currentRunId)
			await this.loadAuthorized("run", investigation.currentRunId);
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(row.cursorSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		);
		const scope = JSON.stringify([
			this.principal.id,
			investigation.investigationId,
			investigation.revision,
			request.detail ?? "full",
			this.fences(),
		]);
		let after = 0;
		if (request.cursor) {
			const parts = request.cursor.split(".");
			if (
				parts.length !== 2 ||
				!/^(0|[1-9][0-9]*)$/.test(parts[0]) ||
				!/^[0-9a-f]{64}$/.test(parts[1])
			)
				fail("cursor_invalid", "Invalid cursor");
			after = Number(parts[0]);
			const signature = Uint8Array.from(parts[1].match(/../g) ?? [], (byte) =>
				Number.parseInt(byte, 16),
			);
			if (
				!Number.isSafeInteger(after) ||
				after > investigation.revision ||
				!(await crypto.subtle.verify(
					"HMAC",
					key,
					signature,
					new TextEncoder().encode(`${scope}:${after}`),
				))
			)
				fail("cursor_invalid", "Invalid cursor");
		}
		const decisions = await this.queryAuthorized(
			investigation.investigationId,
			after,
			65,
		);
		const result: Investigation = { ...investigation, decisions: [] };
		let more = false;
		for (const decision of decisions) {
			if (
				result.decisions &&
				(result.decisions.length === 64 ||
					new TextEncoder().encode(
						JSON.stringify({
							...result,
							decisions: [...result.decisions, decision],
						}),
					).length > 15000)
			) {
				more = true;
				break;
			}
			result.decisions?.push(decision);
		}
		if (more && !result.decisions?.length)
			fail("limit_exceeded", "A decision exceeds the response limit");
		const last =
			result.decisions?.[result.decisions.length - 1]?.resultingRevision ??
			after;
		let nextCursor: string | null = null;
		if (more) {
			const signature = await crypto.subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(`${scope}:${last}`),
			);
			nextCursor = `${last}.${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		}
		result.page = {
			nextCursor,
			truncated: more ? { is: true, reason: "response_cap" } : { is: false },
		};
		return result;
	}
}

export class AuthorizedMutationCtx extends AuthorizedCtx {
	#ctx: MutationCtx;
	constructor(
		ctx: MutationCtx,
		principal: Principal,
		operationId: OperationId,
	) {
		super(ctx, principal, operationId);
		this.#ctx = ctx;
	}

	async #grant(kind: ResourceKind, id: string): Promise<void> {
		await this.#ctx.db.insert("grants", {
			principal: this.principal.id,
			resourceKind: kind,
			resourceId: id,
			actions: OWNED_ACTIONS,
			epoch: 1,
		});
	}

	async createInvestigation(
		value: Omit<Investigation, "investigationId">,
	): Promise<string> {
		for (const snapshotId of value.snapshotIds)
			await this.requireAccess("snapshot", snapshotId);
		const id = await this.#ctx.db.insert("investigations", {
			body: "",
			cursorSecret: crypto.randomUUID(),
		});
		const body: Investigation = { ...value, investigationId: id };
		await this.#ctx.db.patch(id, { body: JSON.stringify(body) });
		await this.#grant("investigation", id);
		return id;
	}

	async appendDecision(value: Omit<Decision, "decisionId">): Promise<string> {
		const parent = await this.loadAuthorized(
			"investigation",
			value.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		await this.authorizeDecision(value, investigation);
		if (compareRevision(value.madeAtRevision, investigation.revision) !== "ok")
			fail("revision_conflict", "Investigation revision changed", {
				currentRevision: investigation.revision,
			});
		const id = await this.#ctx.db.insert("decisions", {
			investigationId: parent._id,
			resultingRevision: value.resultingRevision,
			body: "",
		});
		// Do not admit a decision which could never fit on an investigation page.
		if (
			new TextEncoder().encode(
				JSON.stringify({
					...investigation,
					revision: value.resultingRevision,
					decisions: [{ ...value, decisionId: id }],
				}),
			).length > 15000
		)
			fail("limit_exceeded", "Decision cannot fit on an investigation page");
		await this.#ctx.db.patch(id, {
			body: JSON.stringify({ ...value, decisionId: id }),
		});
		await this.#grant("decision", id);
		await this.#ctx.db.patch(parent._id, {
			body: JSON.stringify({
				...investigation,
				revision: value.resultingRevision,
				currentRunId: null,
			}),
		});
		return id;
	}

	async createRun(value: Omit<Run, "runId">): Promise<string> {
		const parent = await this.loadAuthorized(
			"investigation",
			value.investigationId,
		);
		const investigation = decode<Investigation>(
			validators.Investigation,
			parent.body,
		);
		if (compareRevision(value.baseRevision, investigation.revision) !== "ok")
			fail("revision_conflict", "Investigation revision changed", {
				currentRevision: investigation.revision,
			});
		for (const finding of investigation.acceptedFindings ?? []) {
			await this.requireAccess("finding", finding.findingId);
			await this.authorizeRefs(finding.refs, investigation);
		}
		const decisions = await this.queryAuthorized(
			value.investigationId,
			0,
			1025,
		);
		if (decisions.length > 1024)
			fail("limit_exceeded", "Run input exceeds decision limit");
		// The investigation row serializes admissions. Its pointer avoids an
		// unbounded scan of historical runs, each of which has its own grant.
		if (investigation.currentRunId) {
			const run = await new AuthorizedCtx(
				this.#ctx,
				this.principal,
				this.operationId,
			).run(investigation.currentRunId);
			if (run.status === "admitted" || run.status === "running")
				fail(
					"limit_exceeded",
					"An active run already exists for this revision",
				);
		}
		const id = await this.#ctx.db.insert("runs", {
			investigationId: parent._id,
			baseRevision: value.baseRevision,
			principal: this.principal.id,
			fences: this.fences(),
			body: "",
		});
		await this.#grant("run", id);
		await this.requireAccess("run", id);
		await this.#ctx.db.patch(id, {
			body: JSON.stringify({ ...value, runId: id }),
			fences: this.fences(),
		});
		await this.#ctx.db.patch(parent._id, {
			body: JSON.stringify({ ...investigation, currentRunId: id }),
		});
		return id;
	}

	async cancelRun(id: string): Promise<void> {
		const row = await this.loadAuthorized("run", id);
		const run = decode<Run>(validators.Run, row.body);
		if (run.status === "admitted" || run.status === "running")
			await this.#ctx.db.patch(row._id, {
				body: JSON.stringify({
					...run,
					status: "cancelled",
					finishedAt: Date.now(),
				}),
			});
	}
}
