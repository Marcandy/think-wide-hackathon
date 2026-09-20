// @vitest-environment edge-runtime
// Issue #14 part 2 (decision 0003): recordDecision stores and returns an optional category.
// Real handlers through the operation pipeline; nothing is mocked.

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { argumentDigest } from "../../core";
import type {
	Decision,
	OperationError,
	RecordDecisionRequest,
} from "../../generated/types";
import {
	Decision as isDecision,
	OperationError as isOperationError,
} from "../../generated/validators.js";
import { PRINCIPAL_A, PRINCIPAL_B } from "../fixtures/identities";

const modules = import.meta.glob("../../convex/**/*.ts");
const identity = (p: typeof PRINCIPAL_A) => ({
	tokenIdentifier: `${p.issuer}|${p.subject}`,
	subject: p.subject,
	issuer: p.issuer,
});
const identityA = identity(PRINCIPAL_A);
const identityB = identity(PRINCIPAL_B);
const KINDS = ["correction", "constraint", "rejection", "acceptance"] as const;
const CATEGORIES = ["architecture", "security"] as const;

async function fixture() {
	const t = convexTest(schema, modules);
	const a = t.withIdentity(identityA);
	const b = t.withIdentity(identityB);
	await t.run(async (ctx) => {
		await ctx.db.insert("grants", {
			principal: identityA.tokenIdentifier,
			resourceKind: "snapshot",
			resourceId: "snapshot_A",
			role: "owner",
			epoch: 1,
		});
	});
	const investigation = await a.mutation(api.investigations.openInvestigation, {
		request: {
			question: "Compare the implementations",
			snapshotIds: ["snapshot_A"],
			requestKey: "open-key-0001",
		},
	});
	return { t, a, b, investigationId: investigation.investigationId };
}

async function errorOf(promise: Promise<unknown>): Promise<OperationError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(ConvexError);
		if (!(error instanceof ConvexError)) throw error;
		const data: unknown =
			typeof error.data === "string" ? JSON.parse(error.data) : error.data;
		expect(isOperationError(data)).toBe(true);
		return data as OperationError;
	}
	throw new Error("Expected operation to reject");
}

const request = (
	investigationId: string,
	extra: Partial<RecordDecisionRequest> = {},
): RecordDecisionRequest => ({
	investigationId,
	expectedRevision: 0,
	kind: "constraint",
	statement: "Never log authentication tokens",
	requestKey: "decision-key-0001",
	...extra,
});

const rows = (t: Awaited<ReturnType<typeof fixture>>["t"]) =>
	t.run(async (ctx) => ({
		decisions: await ctx.db.query("decisions").collect(),
		receipts: await ctx.db.query("receipts").collect(),
	}));

describe("decision categories through the real recordDecision handler", () => {
	test.each(
		KINDS.flatMap((kind) =>
			CATEGORIES.map((category) => [kind, category] as const),
		),
	)("%s x %s is stored and returned", async (kind, category) => {
		const { t, a, investigationId } = await fixture();
		const decision = await a.mutation(api.decisions.recordDecision, {
			request: request(investigationId, { kind, category }),
		});
		expect(decision.kind).toBe(kind);
		expect(decision.category).toBe(category);
		expect(isDecision(decision)).toBe(true);

		// Stored, not just echoed: the persisted JSON body carries it.
		const { decisions } = await rows(t);
		expect(decisions).toHaveLength(1);
		const stored = JSON.parse(decisions[0]?.body ?? "{}") as Decision;
		expect(stored.category).toBe(category);

		// And a later authorized read returns it.
		const read = await a.query(api.investigations.readInvestigation, {
			request: { investigationId, detail: "full" },
		});
		expect(read.decisions?.map((d) => d.category)).toEqual([category]);
	});

	test("an uncategorized decision reads back with the field absent, nothing fabricated", async () => {
		const { t, a, investigationId } = await fixture();
		const decision = await a.mutation(api.decisions.recordDecision, {
			request: request(investigationId),
		});
		expect("category" in decision).toBe(false);
		const { decisions } = await rows(t);
		const body = decisions[0]?.body ?? "";
		expect(body).not.toContain("category");
		expect("category" in JSON.parse(body)).toBe(false);
		const read = await a.query(api.investigations.readInvestigation, {
			request: { investigationId, detail: "full" },
		});
		expect(read.decisions).toHaveLength(1);
		expect("category" in (read.decisions?.[0] ?? {})).toBe(false);
	});

	test("storage shape is unchanged: category lives in the validated JSON body, not in a column", async () => {
		const { t, a, investigationId } = await fixture();
		await a.mutation(api.decisions.recordDecision, {
			request: request(investigationId, { category: "security" }),
		});
		const { decisions } = await rows(t);
		expect(Object.keys(decisions[0] ?? {}).sort()).toEqual(
			[
				"_creationTime",
				"_id",
				"body",
				"investigationId",
				"resultingRevision",
			].sort(),
		);
	});

	test("invalid categories are rejected by the pipeline and write nothing", async () => {
		const { t, a, investigationId } = await fixture();
		for (const category of ["performance", null, ["security"], "", "Security"])
			expect(
				(
					await errorOf(
						a.mutation(api.decisions.recordDecision, {
							request: { ...request(investigationId), category },
						}),
					)
				).code,
			).toBe("invalid_request");
		const after = await rows(t);
		expect(after.decisions).toHaveLength(0);
		expect(after.receipts).toHaveLength(1); // openInvestigation only
	});

	test("same key + same category replays to the same decision", async () => {
		const { t, a, investigationId } = await fixture();
		const categorized = request(investigationId, { category: "security" });
		const first = await a.mutation(api.decisions.recordDecision, {
			request: categorized,
		});
		const replay = await a.mutation(api.decisions.recordDecision, {
			request: {
				requestKey: categorized.requestKey,
				category: "security",
				statement: categorized.statement,
				kind: categorized.kind,
				expectedRevision: 0,
				investigationId,
			},
		});
		expect(replay).toEqual(first);
		expect(replay.decisionId).toBe(first.decisionId);
		expect(replay.category).toBe("security");
		expect((await rows(t)).decisions).toHaveLength(1);
	});

	test("same key with a changed category is request_key_conflict", async () => {
		const { t, a, investigationId } = await fixture();
		await a.mutation(api.decisions.recordDecision, {
			request: request(investigationId, { category: "security" }),
		});
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: request(investigationId, { category: "architecture" }),
					}),
				)
			).code,
		).toBe("request_key_conflict");
		const { decisions } = await rows(t);
		expect(decisions).toHaveLength(1);
		expect(JSON.parse(decisions[0]?.body ?? "{}").category).toBe("security");
	});

	test("same key, present then omitted, is request_key_conflict", async () => {
		const { t, a, investigationId } = await fixture();
		await a.mutation(api.decisions.recordDecision, {
			request: request(investigationId, { category: "architecture" }),
		});
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: request(investigationId),
					}),
				)
			).code,
		).toBe("request_key_conflict");
		expect((await rows(t)).decisions).toHaveLength(1);
	});

	test("same key, omitted then present, is request_key_conflict", async () => {
		const { t, a, investigationId } = await fixture();
		await a.mutation(api.decisions.recordDecision, {
			request: request(investigationId),
		});
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: request(investigationId, { category: "security" }),
					}),
				)
			).code,
		).toBe("request_key_conflict");
		const { decisions } = await rows(t);
		expect(decisions).toHaveLength(1);
		expect("category" in JSON.parse(decisions[0]?.body ?? "{}")).toBe(false);
	});

	test("the receipt digest already covers category: it is the digest of the whole validated request", async () => {
		const { t, a, investigationId } = await fixture();
		const categorized = request(investigationId, { category: "security" });
		await a.mutation(api.decisions.recordDecision, { request: categorized });
		const receipt = (await rows(t)).receipts.find(
			(r) => r.operationId === "recordDecision",
		);
		expect(receipt?.digest).toBe(await argumentDigest(categorized));
		expect(receipt?.digest).not.toBe(
			await argumentDigest(request(investigationId)),
		);
		expect(receipt?.digest).not.toBe(
			await argumentDigest(
				request(investigationId, { category: "architecture" }),
			),
		);
		// Ids and a digest only: the category is not copied onto the receipt.
		expect(JSON.stringify(receipt)).not.toContain("security");
	});

	test.each([
		"investigation",
		"snapshot",
	])("replay of a categorized decision after %s grant revocation is denied", async (kind) => {
		const { t, a, investigationId } = await fixture();
		const categorized = request(investigationId, { category: "security" });
		await a.mutation(api.decisions.recordDecision, { request: categorized });
		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				if (
					grant.principal === identityA.tokenIdentifier &&
					grant.resourceKind === kind
				)
					await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		const before = await rows(t);
		expect(
			await errorOf(
				a.mutation(api.decisions.recordDecision, { request: categorized }),
			),
		).toEqual({ code: "not_found", message: "Resource not found" });
		// A conflicting replay is denied identically: no oracle on the stored category.
		expect(
			await errorOf(
				a.mutation(api.decisions.recordDecision, {
					request: request(investigationId, { category: "architecture" }),
				}),
			),
		).toEqual({ code: "not_found", message: "Resource not found" });
		expect(await rows(t)).toEqual(before);
	});

	test("a principal without a grant cannot record or replay a categorized decision", async () => {
		const { t, a, b, investigationId } = await fixture();
		const categorized = request(investigationId, { category: "security" });
		await a.mutation(api.decisions.recordDecision, { request: categorized });
		const before = await rows(t);
		expect(
			await errorOf(
				b.mutation(api.decisions.recordDecision, { request: categorized }),
			),
		).toEqual({ code: "not_found", message: "Resource not found" });
		expect(await rows(t)).toEqual(before);
	});
});
