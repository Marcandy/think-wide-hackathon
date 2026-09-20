// @vitest-environment edge-runtime

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { validateResponse } from "../../convex/lib/validation";
import schema from "../../convex/schema";
import { argumentDigest } from "../../core";
import { OPERATIONS } from "../../generated/operations";
import type { OperationError, SourceRef } from "../../generated/types";
import { OperationError as isOperationError } from "../../generated/validators.js";
import { PRINCIPAL_A, PRINCIPAL_B } from "../fixtures/identities";

const modules = import.meta.glob("../../convex/**/*.ts");
const identityA = {
	tokenIdentifier: `${PRINCIPAL_A.issuer}|${PRINCIPAL_A.subject}`,
	subject: PRINCIPAL_A.subject,
	issuer: PRINCIPAL_A.issuer,
};
const identityB = {
	tokenIdentifier: `${PRINCIPAL_B.issuer}|${PRINCIPAL_B.subject}`,
	subject: PRINCIPAL_B.subject,
	issuer: PRINCIPAL_B.issuer,
};
const actions = OPERATIONS.map((operation) => operation.operationId);
const openRequest = {
	question: "Compare the implementations",
	snapshotIds: ["snapshot_A"],
	requestKey: "open-key-0001",
};
const ref: SourceRef = {
	repositoryId: "repo_A",
	snapshotId: "snapshot_A",
	entryId: "entry_A",
	commit: "a".repeat(40),
	blobId: "b".repeat(40),
	hashAlgorithm: "sha1",
	byteRange: { start: 0, end: 1 },
	digest: "c".repeat(64),
};

async function fixture() {
	const t = convexTest(schema, modules);
	const a = t.withIdentity(identityA);
	const b = t.withIdentity(identityB);
	await t.run(async (ctx) => {
		for (const [principal, suffix] of [
			[identityA.tokenIdentifier, "A"],
			[identityB.tokenIdentifier, "B"],
		]) {
			for (const [kind, prefix] of [
				["snapshot", "snapshot"],
				["repository", "repo"],
				["entry", "entry"],
			] as const)
				await ctx.db.insert("grants", {
					principal,
					resourceKind: kind,
					resourceId: `${prefix}_${suffix}`,
					actions,
					epoch: 1,
				});
		}
	});
	return { t, a, b };
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

function decisionRequest(
	investigationId: string,
	expectedRevision = 0,
	requestKey = "decision-key-0001",
) {
	return {
		investigationId,
		expectedRevision,
		kind: "correction" as const,
		statement: "Preserve the human correction",
		requestKey,
	};
}

async function state(t: Awaited<ReturnType<typeof fixture>>["t"]) {
	return t.run(async (ctx) => ({
		investigations: await ctx.db.query("investigations").collect(),
		decisions: await ctx.db.query("decisions").collect(),
		runs: await ctx.db.query("runs").collect(),
		receipts: await ctx.db.query("receipts").collect(),
		grants: await ctx.db.query("grants").collect(),
		jobs: await ctx.db.system.query("_scheduled_functions").collect(),
	}));
}

describe("T06 real handlers", () => {
	test("Q01 positive controls, foreign/missing investigation reads and writes are identical and inert", async () => {
		const { t, a, b } = await fixture();
		const ownA = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const ownB = await b.mutation(api.investigations.openInvestigation, {
			request: { ...openRequest, snapshotIds: ["snapshot_B"] },
		});
		expect(
			(
				await a.query(api.investigations.readInvestigation, {
					request: { investigationId: ownA.investigationId },
				})
			).question,
		).toBe(openRequest.question);
		expect(
			(
				await b.query(api.investigations.readInvestigation, {
					request: { investigationId: ownB.investigationId },
				})
			).question,
		).toBe(openRequest.question);
		const before = await state(t);
		for (const id of [ownA.investigationId, "missing_investigation"]) {
			expect(
				await errorOf(
					b.query(api.investigations.readInvestigation, {
						request: { investigationId: id },
					}),
				),
			).toEqual({ code: "not_found", message: "Resource not found" });
			expect(
				await errorOf(
					b.mutation(api.decisions.recordDecision, {
						request: decisionRequest(id),
					}),
				),
			).toEqual({ code: "not_found", message: "Resource not found" });
		}
		expect(await state(t)).toEqual(before);
	});

	test("foreign snapshot denied and anonymous caller unauthenticated", async () => {
		const { t, b } = await fixture();
		const before = await state(t);
		expect(
			(
				await errorOf(
					b.mutation(api.investigations.openInvestigation, {
						request: openRequest,
					}),
				)
			).code,
		).toBe("not_found");
		expect(
			(
				await errorOf(
					t.mutation(api.investigations.openInvestigation, {
						request: openRequest,
					}),
				)
			).code,
		).toBe("unauthenticated");
		expect(await state(t)).toEqual(before);
	});

	test.each([
		"actor",
		"owner",
		"principal",
		"role",
		"userId",
	])("rejects identity smuggling via %s", async (field) => {
		const { a } = await fixture();
		const error = await errorOf(
			a.mutation(api.investigations.openInvestigation, {
				request: { ...openRequest, [field]: "B" },
			}),
		);
		expect(error.code).toBe("invalid_request");
		expect(error.details?.length).toBeGreaterThan(0);
	});

	test.each([
		null,
		17,
		[],
		{ ...openRequest, snapshotIds: ["invalid/id"] },
		{ ...openRequest, question: "x".repeat(16385) },
	])("rejects invalid request %j", async (request) => {
		const { a } = await fixture();
		expect(
			(
				await errorOf(
					a.mutation(api.investigations.openInvestigation, { request }),
				)
			).code,
		).toBe("invalid_request");
	});

	test("Q07 reordered arguments replay, changed values conflict, receipts store ids only", async () => {
		const { t, a } = await fixture();
		const first = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const replay = await a.mutation(api.investigations.openInvestigation, {
			request: {
				requestKey: openRequest.requestKey,
				snapshotIds: openRequest.snapshotIds,
				question: openRequest.question,
			},
		});
		expect(replay).toEqual(first);
		expect(
			(
				await errorOf(
					a.mutation(api.investigations.openInvestigation, {
						request: { ...openRequest, question: "Changed" },
					}),
				)
			).code,
		).toBe("request_key_conflict");
		const request = decisionRequest(
			first.investigationId,
			0,
			openRequest.requestKey,
		);
		const decision = await a.mutation(api.decisions.recordDecision, {
			request,
		});
		expect(await a.mutation(api.decisions.recordDecision, { request })).toEqual(
			decision,
		);
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: { ...request, statement: "Changed" },
					}),
				)
			).code,
		).toBe("request_key_conflict");
		const rows = await state(t);
		expect(rows.investigations).toHaveLength(1);
		expect(rows.decisions).toHaveLength(1);
		expect(rows.receipts).toHaveLength(2);
		for (const receipt of rows.receipts)
			expect(Object.keys(receipt).sort()).toEqual(
				[
					"_creationTime",
					"_id",
					"digest",
					"operationId",
					"principal",
					"requestKey",
					"resultId",
					"resultKind",
				].sort(),
			);
	});

	test("correction is durable and concurrent expectedRevision contenders have exactly one winner", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const outcomes = await Promise.allSettled([
			a.mutation(api.decisions.recordDecision, {
				request: decisionRequest(inv.investigationId),
			}),
			a.mutation(api.decisions.recordDecision, {
				request: decisionRequest(inv.investigationId, 0, "competing-key"),
			}),
		]);
		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			outcomes.filter((outcome) => outcome.status === "rejected"),
		).toHaveLength(1);
		const view = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId },
		});
		expect(view.revision).toBe(1);
		expect(view.decisions).toMatchObject([
			{
				madeAtRevision: 0,
				resultingRevision: 1,
				statement: "Preserve the human correction",
			},
		]);
		expect(
			await errorOf(
				a.mutation(api.decisions.recordDecision, {
					request: decisionRequest(inv.investigationId, 0, "stale-key-0001"),
				}),
			),
		).toEqual({
			code: "revision_conflict",
			message: "Investigation revision changed",
			currentRevision: 1,
		});
		expect((await state(t)).decisions).toHaveLength(1);
	});

	test.each([
		"investigation",
		"snapshot",
		"decision",
	])("revoked %s denies current reads and receipt replays", async (kind) => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const request = decisionRequest(inv.investigationId);
		await a.mutation(api.decisions.recordDecision, { request });
		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				if (
					grant.principal === identityA.tokenIdentifier &&
					grant.resourceKind === kind
				)
					await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		const before = await state(t);
		expect(
			(
				await errorOf(
					a.query(api.investigations.readInvestigation, {
						request: { investigationId: inv.investigationId },
					}),
				)
			).code,
		).toBe("not_found");
		expect(
			(
				await errorOf(
					a.mutation(api.investigations.openInvestigation, {
						request: openRequest,
					}),
				)
			).code,
		).toBe("not_found");
		expect(
			(await errorOf(a.mutation(api.decisions.recordDecision, { request })))
				.code,
		).toBe("not_found");
		expect(await state(t)).toEqual(before);
	});

	test("operation permission is required independently of object grant", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		await t.run(async (ctx) => {
			const grant = await ctx.db
				.query("grants")
				.withIndex("by_principal_resource", (q) =>
					q
						.eq("principal", identityA.tokenIdentifier)
						.eq("resourceKind", "investigation")
						.eq("resourceId", inv.investigationId),
				)
				.unique();
			if (grant)
				await ctx.db.patch(grant._id, { actions: ["readInvestigation"] });
		});
		expect(
			(
				await a.query(api.investigations.readInvestigation, {
					request: { investigationId: inv.investigationId },
				})
			).revision,
		).toBe(0);
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: decisionRequest(inv.investigationId),
					}),
				)
			).code,
		).toBe("not_found");
	});

	test("Q03 nested references and finding ids require independent grants", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const before = await state(t);
		for (const foreignRef of [
			{ ...ref, repositoryId: "repo_B" },
			{ ...ref, snapshotId: "snapshot_B" },
			{ ...ref, entryId: "entry_B" },
		])
			expect(
				(
					await errorOf(
						a.mutation(api.decisions.recordDecision, {
							request: {
								...decisionRequest(inv.investigationId),
								refs: [foreignRef],
							},
						}),
					)
				).code,
			).toBe("not_found");
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: {
							...decisionRequest(inv.investigationId),
							targetFindingId: "foreign_finding",
						},
					}),
				)
			).code,
		).toBe("not_found");
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: {
							...decisionRequest(inv.investigationId),
							refs: [{ ...ref, byteRange: { start: 0, end: 1, actor: "B" } }],
						},
					}),
				)
			).code,
		).toBe("invalid_request");
		expect(await state(t)).toEqual(before);
		await a.mutation(api.decisions.recordDecision, {
			request: { ...decisionRequest(inv.investigationId), refs: [ref] },
		});
	});

	test("canonical digest uses SHA-256 and preserves nested distinctions", async () => {
		expect(await argumentDigest({})).toBe(
			"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
		);
		expect(await argumentDigest({ a: { b: 1, c: 2 } })).toBe(
			await argumentDigest({ a: { c: 2, b: 1 } }),
		);
		expect(await argumentDigest({ a: { b: 1 } })).not.toBe(
			await argumentDigest({ a: { b: 2 } }),
		);
	});

	test("Q03 pagination rejects swapped, altered, changed-detail, changed-epoch and stale-revision cursors", async () => {
		const { t, a, b } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		for (let revision = 0; revision < 5; revision++)
			await a.mutation(api.decisions.recordDecision, {
				request: {
					...decisionRequest(
						inv.investigationId,
						revision,
						`page-key-${revision}`,
					),
					statement: "x".repeat(4000),
				},
			});
		const first = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId },
		});
		const cursor = first.page?.nextCursor;
		expect(cursor).toBeTruthy();
		if (!cursor) throw new Error("Expected pagination");
		const second = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId, cursor },
		});
		expect([
			...(first.decisions ?? []),
			...(second.decisions ?? []),
		]).toHaveLength(5);
		const other = await a.mutation(api.investigations.openInvestigation, {
			request: { ...openRequest, requestKey: "other-inv-key" },
		});
		for (const request of [
			{ investigationId: other.investigationId, cursor },
			{ investigationId: inv.investigationId, cursor: `${cursor}x` },
			{ investigationId: inv.investigationId, detail: "summary", cursor },
		])
			expect(
				(
					await errorOf(
						a.query(api.investigations.readInvestigation, { request }),
					)
				).code,
			).toBe("cursor_invalid");
		expect(
			(
				await errorOf(
					b.query(api.investigations.readInvestigation, {
						request: { investigationId: inv.investigationId, cursor },
					}),
				)
			).code,
		).toBe("not_found");
		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				if (
					grant.resourceKind === "snapshot" &&
					grant.resourceId === "snapshot_A"
				)
					await ctx.db.patch(grant._id, { epoch: grant.epoch + 1 });
		});
		expect(
			(
				await errorOf(
					a.query(api.investigations.readInvestigation, {
						request: { investigationId: inv.investigationId, cursor },
					}),
				)
			).code,
		).toBe("cursor_invalid");
		const current = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId },
		});
		await a.mutation(api.decisions.recordDecision, {
			request: decisionRequest(inv.investigationId, 5, "advance-key-6"),
		});
		expect(
			(
				await errorOf(
					a.query(api.investigations.readInvestigation, {
						request: {
							investigationId: inv.investigationId,
							cursor: current.page?.nextCursor ?? "missing",
						},
					}),
				)
			).code,
		).toBe("cursor_invalid");
	});

	test.each([
		"decision",
		"cancel",
		"revoke",
		"epoch",
	])("Q06 publication fenced after %s", async (change) => {
		const { t, a, b } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const runRequest = {
			investigationId: inv.investigationId,
			expectedRevision: 0,
			purpose: "compare",
			requestKey: "run-key-0001",
		};
		const run = await a.mutation(api.runs.admitRun, { request: runRequest });
		expect(
			await a.mutation(api.runs.admitRun, { request: runRequest }),
		).toEqual(run);
		expect(
			(
				await errorOf(
					a.mutation(api.runs.admitRun, {
						request: { ...runRequest, requestKey: "another-run-key" },
					}),
				)
			).code,
		).toBe("limit_exceeded");
		for (const runId of [run.runId, "missing_run"]) {
			expect(
				await errorOf(b.query(api.runs.getRun, { request: { runId } })),
			).toEqual({ code: "not_found", message: "Resource not found" });
			expect(
				(
					await errorOf(
						b.mutation(api.runs.cancelRun, {
							request: { runId, requestKey: "cancel-key-01" },
						}),
					)
				).code,
			).toBe("not_found");
		}
		if (change === "decision")
			await a.mutation(api.decisions.recordDecision, {
				request: decisionRequest(inv.investigationId),
			});
		if (change === "cancel")
			await a.mutation(api.runs.cancelRun, {
				request: { runId: run.runId, requestKey: "cancel-key-01" },
			});
		if (change === "revoke" || change === "epoch")
			await t.run(async (ctx) => {
				for (const grant of await ctx.db.query("grants").collect())
					if (grant.resourceId === "snapshot_A")
						await ctx.db.patch(
							grant._id,
							change === "revoke"
								? { revokedAt: Date.now() }
								: { epoch: grant.epoch + 1 },
						);
			});
		const result = await t.mutation(internal.runs.publish, {
			request: {
				investigationId: inv.investigationId,
				runId: run.runId,
				baseRevision: 0,
				claims: [
					{
						statement: "Late model result",
						evidenceClass: "model_hypothesis",
						refs: [ref],
					},
				],
			},
		});
		expect(result).toEqual({
			published: false,
			status: change === "cancel" ? "cancelled" : "superseded",
		});
		const rows = await state(t);
		expect(JSON.parse(rows.runs[0].body).status).toBe(result.status);
		expect(rows.decisions).toHaveLength(change === "decision" ? 1 : 0);
		expect(
			JSON.parse(rows.investigations[0].body).acceptedFindings,
		).toBeUndefined();
	});

	test("valid publication is durable and does not overwrite decisions; cancel does not undo it", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		await a.mutation(api.decisions.recordDecision, {
			request: { ...decisionRequest(inv.investigationId), refs: [ref] },
		});
		const run = await a.mutation(api.runs.admitRun, {
			request: {
				investigationId: inv.investigationId,
				expectedRevision: 1,
				purpose: "compare",
				requestKey: "run-key-0001",
			},
		});
		const request = {
			investigationId: inv.investigationId,
			runId: run.runId,
			baseRevision: 1,
			claims: [
				{
					statement: "A hypothesis",
					evidenceClass: "model_hypothesis",
					refs: [ref],
				},
			],
		};
		expect(await t.mutation(internal.runs.publish, { request })).toEqual({
			published: true,
			status: "published",
		});
		expect(await t.mutation(internal.runs.publish, { request })).toEqual({
			published: false,
			status: "published",
		});
		const view = await a.query(api.investigations.readInvestigation, {
			request: { investigationId: inv.investigationId },
		});
		expect(view.decisions).toHaveLength(1);
		expect(view.acceptedFindings).toMatchObject([
			{ summary: "A hypothesis", verification: "unverified" },
		]);
		expect(
			(
				await a.mutation(api.runs.cancelRun, {
					request: { runId: run.runId, requestKey: "cancel-key-01" },
				})
			).status,
		).toBe("published");
	});

	test("oversize writes roll back receipts, grants, decisions and revision", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const before = await state(t);
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: {
							...decisionRequest(inv.investigationId),
							statement: "x".repeat(15000),
						},
					}),
				)
			).code,
		).toBe("limit_exceeded");
		expect(
			(
				await errorOf(
					a.mutation(api.investigations.openInvestigation, {
						request: {
							...openRequest,
							requestKey: "oversized-open",
							question: "😀".repeat(8000),
						},
					}),
				)
			).code,
		).toBe("limit_exceeded");
		expect(await state(t)).toEqual(before);
	});

	test("deep payloads and unsafe revisions return contract errors without effects", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const before = await state(t);
		let nested: unknown = "A";
		for (let depth = 0; depth < 40; depth++) nested = { actor: nested };
		expect(
			(
				await errorOf(
					a.mutation(api.investigations.openInvestigation, {
						request: { ...openRequest, nested },
					}),
				)
			).code,
		).toBe("invalid_request");
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: decisionRequest(
							inv.investigationId,
							Number.MAX_SAFE_INTEGER,
						),
					}),
				)
			).code,
		).toBe("invalid_request");
		expect(await state(t)).toEqual(before);
	});

	test("identical args and keys across principals create independent investigations", async () => {
		const { t, a, b } = await fixture();
		await t.run(async (ctx) => {
			await ctx.db.insert("grants", {
				principal: identityB.tokenIdentifier,
				resourceKind: "snapshot",
				resourceId: "snapshot_A",
				actions,
				epoch: 1,
			});
		});
		const ownA = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const ownB = await b.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		expect(ownA.investigationId).not.toBe(ownB.investigationId);
		expect((await state(t)).receipts).toHaveLength(2);
		expect(
			(
				await errorOf(
					b.query(api.investigations.readInvestigation, {
						request: { investigationId: ownA.investigationId },
					}),
				)
			).code,
		).toBe("not_found");
	});

	test("revoked entry denies decision replay, run reads and new decisions targeting its finding", async () => {
		const { t, a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const decision = { ...decisionRequest(inv.investigationId), refs: [ref] };
		await a.mutation(api.decisions.recordDecision, { request: decision });
		const runRequest = {
			investigationId: inv.investigationId,
			expectedRevision: 1,
			purpose: "compare",
			requestKey: "reference-run-key",
		};
		const run = await a.mutation(api.runs.admitRun, { request: runRequest });
		await t.mutation(internal.runs.publish, {
			request: {
				investigationId: inv.investigationId,
				runId: run.runId,
				baseRevision: 1,
				claims: [
					{
						statement: "A hypothesis",
						evidenceClass: "model_hypothesis",
						refs: [ref],
					},
				],
			},
		});
		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				if (grant.resourceId === "entry_A")
					await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		const before = await state(t);
		const errors = await Promise.all(
			[
				a.mutation(api.decisions.recordDecision, { request: decision }),
				a.query(api.runs.getRun, { request: { runId: run.runId } }),
				a.mutation(api.runs.admitRun, { request: runRequest }),
				a.mutation(api.decisions.recordDecision, {
					request: {
						...decisionRequest(inv.investigationId, 1, "target-ref-key"),
						targetFindingId: `${run.runId}:0`,
					},
				}),
			].map(errorOf),
		);
		for (const error of errors) expect(error.code).toBe("not_found");
		expect(await state(t)).toEqual(before);
	});

	test("nested argument changes conflict while reordered source references replay", async () => {
		const { a } = await fixture();
		const inv = await a.mutation(api.investigations.openInvestigation, {
			request: openRequest,
		});
		const request = { ...decisionRequest(inv.investigationId), refs: [ref] };
		const decision = await a.mutation(api.decisions.recordDecision, {
			request,
		});
		expect(
			await a.mutation(api.decisions.recordDecision, {
				request: {
					...request,
					refs: [{ ...ref, byteRange: { end: 1, start: 0 } }],
				},
			}),
		).toEqual(decision);
		expect(
			(
				await errorOf(
					a.mutation(api.decisions.recordDecision, {
						request: {
							...request,
							refs: [{ ...ref, byteRange: { start: 0, end: 2 } }],
						},
					}),
				)
			).code,
		).toBe("request_key_conflict");
	});

	test("envelope kind and entries use operation-specific generated validators", () => {
		const envelope = {
			kind: "projects",
			scope: { snapshotIds: [] },
			entries: [],
			coverage: { status: "complete" },
			nextCursor: null,
			truncated: { is: false },
		};
		expect(validateResponse("listProjects", envelope)).toEqual(envelope);
		expect(() =>
			validateResponse("listProjects", { ...envelope, kind: "guidance" }),
		).toThrow();
		expect(() =>
			validateResponse("listProjects", { ...envelope, entries: [{}] }),
		).toThrow();
	});
});
