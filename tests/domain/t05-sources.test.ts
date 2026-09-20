// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Project, SnapshotEntry } from "../../generated/types";
import { readHistory } from "../../src/server/git/history";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import { literalSearch } from "../../src/server/search/literal";
import {
	bundlePath,
	FIXTURE_FILES,
	readManifest,
} from "../fixtures/repos/cases";

const register = internal.snapshots.register;
const put = internal.sourceCache.put;
const browse = api.snapshots.browseSnapshot;
const read = api.sourceCache.readSource;
const projects = api.projects.listProjects;
const modules = import.meta.glob("../../convex/**/*.ts");
const identityA = { tokenIdentifier: "test|A", issuer: "test", subject: "A" };
const identityB = { tokenIdentifier: "test|B", issuer: "test", subject: "B" };
let alpha: GitSnapshot;
let beta: GitSnapshot;
let project: Project;
let entry: SnapshotEntry;
let original: ArrayBuffer;

beforeAll(async () => {
	alpha = await openSnapshot({
		repositoryId: "alpha",
		bundlePath: bundlePath("alpha"),
	});
	beta = await openSnapshot({
		repositoryId: "beta",
		bundlePath: bundlePath("beta"),
	});
	project = {
		repositoryId: "alpha",
		displayName: "Synthetic alpha",
		provider: "local-git",
		syncStatus: "ready",
		dataLabel: "synthetic",
		snapshots: [alpha.summary],
	};
	const found = alpha.entries.find(
		(item) => item.displayPath === "src/alpha.ts",
	);
	if (!found) throw new Error("Missing independent fixture entry");
	entry = found;
	original = Uint8Array.from(await alpha.blob(entry.entryId)).buffer;
});
afterAll(async () => {
	await alpha?.close();
	await beta?.close();
});

async function fixture() {
	const t = convexTest(schema, modules);
	const a = t.withIdentity(identityA);
	const b = t.withIdentity(identityB);
	await a.mutation(register, { project, entries: alpha.entries });
	return { t, a, b };
}
const request = () => ({
	snapshotId: alpha.summary.snapshotId,
	entryId: entry.entryId,
});

describe("T05 real protected source handlers", () => {
	it("maps real Git search hits to reproducible authorized evidence refs", async () => {
		const { a } = await fixture();
		await a.mutation(put, { ...request(), bytes: original });
		const searched = literalSearch([await alpha.scanEntry(entry.entryId)], {
			text: "SYNTHETIC_ALPHA_MARKER_0001",
		});
		const ref = searched.entries[0].refs[0];
		expect(ref.hashAlgorithm).toBe(alpha.summary.hashAlgorithm);
		const evidence = await a.query(read, {
			request: { ...request(), byteRange: ref.byteRange },
		});
		expect(evidence.ref.digest).toBe(ref.digest);
		expect(evidence.ref.blobId).toBe(ref.blobId);
		expect(evidence.content).toBe("SYNTHETIC_ALPHA_MARKER_0001");
	});

	it("reads real first-parent history and root diffs, with scoped bounded cursors", async () => {
		const page = await readHistory(alpha, {
			snapshotId: alpha.summary.snapshotId,
			maxCommits: 1,
		});
		expect(page.entries[0].commit).toBe(readManifest().repos.alpha.headCommit);
		expect(page.entries[0].comparedTo).toBe(
			readManifest().repos.alpha.staleCommit,
		);
		expect(page.entries[0].changedPaths).toContain("src/alpha.ts");
		expect(page.nextCursor).toBeTruthy();
		const next = await readHistory(alpha, {
			snapshotId: alpha.summary.snapshotId,
			maxCommits: 1,
			cursor: page.nextCursor ?? undefined,
		});
		expect(next.entries[0].commit).toBe(readManifest().repos.alpha.staleCommit);
		expect(next.entries[0].comparedTo).toBeNull();
		expect(next.entries[0].changedPaths).toContain("src/alpha.ts");
		expect(next.nextCursor).toBeNull();
		await expect(
			readHistory(alpha, {
				snapshotId: alpha.summary.snapshotId,
				entryId: entry.entryId,
				maxCommits: 1,
				cursor: page.nextCursor ?? undefined,
			}),
		).rejects.toMatchObject({ code: "cursor_invalid" });
		await expect(
			readHistory(beta, {
				snapshotId: beta.summary.snapshotId,
				maxCommits: 1,
				cursor: page.nextCursor ?? undefined,
			}),
		).rejects.toMatchObject({ code: "cursor_invalid" });
		await expect(
			readHistory(alpha, {
				snapshotId: alpha.summary.snapshotId,
				entryId: "missing",
			}),
		).rejects.toMatchObject({ code: "source_unavailable" });
		const filtered = await readHistory(alpha, {
			snapshotId: alpha.summary.snapshotId,
			entryId: entry.entryId,
		});
		expect(filtered.entries.map((record) => record.commit)).toEqual([
			page.entries[0].commit,
			next.entries[0].commit,
		]);
	});

	it("serves authorized cached history, preserves partial coverage, and fences revoked cursors", async () => {
		const { t, a, b } = await fixture();
		const history = await readHistory(alpha, {
			snapshotId: alpha.summary.snapshotId,
		});
		const input = {
			snapshotId: alpha.summary.snapshotId,
			records: history.entries,
			complete: true,
		};
		await expect(
			a.query(api.snapshots.readHistory, {
				request: { snapshotId: input.snapshotId },
			}),
		).rejects.toThrow("History is unavailable");
		await expect(
			b.mutation(internal.snapshots.putHistory, input),
		).rejects.toThrow("Resource not found");
		await expect(
			a.mutation(internal.snapshots.putHistory, {
				...input,
				records: [...history.entries].reverse(),
			}),
		).rejects.toThrow("first-parent");
		await a.mutation(internal.snapshots.putHistory, input);
		const request = { snapshotId: input.snapshotId, maxCommits: 1 };
		const first = await a.query(api.snapshots.readHistory, { request });
		expect(first.entries).toEqual(history.entries.slice(0, 1));
		const last = await a.query(api.snapshots.readHistory, {
			request: { ...request, cursor: first.nextCursor },
		});
		expect(last.entries).toEqual(history.entries.slice(1));
		expect(last.coverage.status).toBe("complete");
		await a.mutation(internal.snapshots.putHistory, {
			...input,
			complete: false,
			records: history.entries.slice(0, 1),
		});
		const partial = await a.query(api.snapshots.readHistory, { request });
		expect(partial.coverage.status).toBe("partial");
		expect(partial.nextCursor).toBeNull();
		await expect(
			a.query(api.snapshots.readHistory, {
				request: { ...request, cursor: first.nextCursor },
			}),
		).rejects.toThrow("Invalid cursor");
		await t.run(async (ctx) => {
			const grant = await ctx.db.query("grants").first();
			if (!grant) throw new Error("Missing grant");
			await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		await expect(
			a.query(api.snapshots.readHistory, { request }),
		).rejects.toThrow("Resource not found");
	});

	it("keeps tree cursors bound to principal/parent and rechecks access after paging", async () => {
		const t = convexTest(schema, modules);
		const a = t.withIdentity(identityA);
		const b = t.withIdentity(identityB);
		const entries: SnapshotEntry[] = Array.from({ length: 130 }, (_, i) => ({
			...entry,
			entryId: `page_${String(i).padStart(3, "0")}`,
			parentEntryId: null,
			name: `file-${i}.txt`,
		}));
		await a.mutation(register, { project, entries });
		await t.run((ctx) =>
			ctx.db.insert("grants", {
				principal: identityB.tokenIdentifier,
				resourceKind: "snapshot",
				resourceId: alpha.summary.snapshotId,
				role: "reader",
				epoch: 1,
			}),
		);
		let page = await a.query(browse, {
			request: { snapshotId: alpha.summary.snapshotId },
		});
		expect(page.nextCursor).toBeTruthy();
		const cursor = String(page.nextCursor);
		await expect(
			b.query(browse, {
				request: { snapshotId: alpha.summary.snapshotId, cursor },
			}),
		).rejects.toThrow("cursor_invalid");
		const found: unknown[] = [];
		for (let count = 0; count < 20; count++) {
			expect(
				new TextEncoder().encode(JSON.stringify(page)).length,
			).toBeLessThanOrEqual(16384);
			found.push(...page.entries);
			if (!page.nextCursor) break;
			page = await a.query(browse, {
				request: {
					snapshotId: alpha.summary.snapshotId,
					cursor: page.nextCursor ?? undefined,
				},
			});
		}
		expect(found).toHaveLength(130);
		expect(new Set(found.map((item) => JSON.stringify(item))).size).toBe(130);
		await t.run(async (ctx) => {
			const grant = await ctx.db
				.query("grants")
				.withIndex("by_principal_resource", (q) =>
					q.eq("principal", identityA.tokenIdentifier),
				)
				.first();
			if (grant) await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		await expect(
			a.query(browse, {
				request: { snapshotId: alpha.summary.snapshotId, cursor },
			}),
		).rejects.toThrow("not_found");
	});

	it("filters project pages by principal, including pages containing only revoked grants", async () => {
		const { t, a, b } = await fixture();
		for (let i = 0; i < 11; i++) {
			const snapshotId = `scan_${String(i).padStart(3, "0")}`;
			await a.mutation(register, {
				project: { ...project, snapshots: [{ ...alpha.summary, snapshotId }] },
				entries: [],
			});
		}
		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect()) {
				if (
					grant.resourceId.startsWith("scan_") &&
					grant.resourceId < "scan_09"
				)
					await ctx.db.patch(grant._id, { revokedAt: Date.now() });
			}
		});
		let page = await a.query(projects, { request: {} });
		const ids: string[] = [];
		const cursor = page.nextCursor;
		if (cursor)
			await expect(b.query(projects, { request: { cursor } })).rejects.toThrow(
				"cursor_invalid",
			);
		for (let i = 0; i < 10; i++) {
			ids.push(...page.scope.snapshotIds);
			if (!page.nextCursor) break;
			page = await a.query(projects, {
				request: { cursor: page.nextCursor ?? undefined },
			});
		}
		expect(ids).toEqual([alpha.summary.snapshotId]);
	});
	it("registers snapshot, entries and owner grant atomically from verified identity", async () => {
		const { t, a, b } = await fixture();
		expect(
			(await a.query(projects, { request: {} })).scope.snapshotIds,
		).toEqual([alpha.summary.snapshotId]);
		expect((await b.query(projects, { request: {} })).entries).toEqual([]);
		const grants = await t.run((ctx) => ctx.db.query("grants").collect());
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			principal: "test|A",
			resourceKind: "snapshot",
			resourceId: alpha.summary.snapshotId,
			role: "owner",
		});
		await a.mutation(register, { project, entries: alpha.entries });
		expect(await t.run((ctx) => ctx.db.query("grants").collect())).toHaveLength(
			1,
		);
		await expect(
			b.mutation(register, { project, entries: alpha.entries }),
		).rejects.toThrow("not_found");
		await expect(
			t.mutation(register, { project, entries: alpha.entries }),
		).rejects.toThrow("unauthenticated");
	});

	it("rejects an invalid index without leaving rows or grants behind", async () => {
		const t = convexTest(schema, modules);
		const a = t.withIdentity(identityA);
		await expect(
			a.mutation(register, {
				project,
				entries: [{ ...entry, parentEntryId: entry.entryId }],
			}),
		).rejects.toThrow("Invalid tree ancestry");
		expect(
			await t.run(async (ctx) => [
				await ctx.db.query("snapshots").collect(),
				await ctx.db.query("entries").collect(),
				await ctx.db.query("grants").collect(),
			]),
		).toEqual([[], [], []]);
	});

	it("authorizes before browsing and keeps foreign/missing snapshots indistinguishable", async () => {
		const { t, a, b } = await fixture();
		const root = await a.query(browse, {
			request: { snapshotId: alpha.summary.snapshotId },
		});
		expect(root.entries.length).toBeGreaterThan(0);
		for (const snapshotId of [alpha.summary.snapshotId, "missing"]) {
			await expect(
				b.query(browse, { request: { snapshotId } }),
			).rejects.toThrow('"code":"not_found","message":"Resource not found"');
			await expect(
				b.query(read, { request: { snapshotId, entryId: entry.entryId } }),
			).rejects.toThrow('"code":"not_found","message":"Resource not found"');
		}
		await expect(
			t.query(browse, { request: { snapshotId: alpha.summary.snapshotId } }),
		).rejects.toThrow("unauthenticated");
	});

	it("verifies Git blob identity on cache writes and exact-byte digest on reads", async () => {
		const { a } = await fixture();
		await expect(a.query(read, { request: request() })).rejects.toThrow(
			"source_unavailable",
		);
		await expect(
			a.mutation(put, {
				...request(),
				bytes: new Uint8Array(original.byteLength).buffer,
			}),
		).rejects.toThrow("integrity");
		await a.mutation(put, { ...request(), bytes: original });
		const evidence = await a.query(read, { request: request() });
		expect(evidence.content).toBe(
			FIXTURE_FILES.find((item) => item.path === "src/alpha.ts")?.content,
		);
		expect(`sha256:${evidence.ref.digest}`).toBe(
			FIXTURE_FILES.find((item) => item.path === "src/alpha.ts")?.sha256,
		);
		expect(evidence.ref.blobId).toBe(entry.objectId);
		expect(evidence.ref.byteRange).toEqual({
			start: 0,
			end: original.byteLength,
		});
	});

	it("detects corrupt/evicted bytes and rechecks revoked grants on every read", async () => {
		const { t, a } = await fixture();
		await a.mutation(put, { ...request(), bytes: original });
		await t.run(async (ctx) => {
			const cache = await ctx.db.query("sourceCache").first();
			if (cache)
				await ctx.db.patch(cache._id, {
					bytes: new Uint8Array(original.byteLength).buffer,
				});
		});
		await expect(a.query(read, { request: request() })).rejects.toThrow(
			"source_unavailable",
		);
		await a.mutation(put, { ...request(), bytes: original });
		await t.run(async (ctx) => {
			const cache = await ctx.db.query("sourceCache").first();
			if (cache) await ctx.db.delete(cache._id);
		});
		await expect(a.query(read, { request: request() })).rejects.toThrow(
			"source_unavailable",
		);
		await a.mutation(put, { ...request(), bytes: original });
		await t.run(async (ctx) => {
			const grant = await ctx.db.query("grants").first();
			if (grant) await ctx.db.patch(grant._id, { revokedAt: Date.now() });
		});
		await expect(a.query(read, { request: request() })).rejects.toThrow(
			"not_found",
		);
		await expect(
			a.mutation(put, { ...request(), bytes: original }),
		).rejects.toThrow("not_found");
	});

	it("allows shared readers to read but not populate source bytes", async () => {
		const { t, a, b } = await fixture();
		await a.mutation(put, { ...request(), bytes: original });
		await t.run((ctx) =>
			ctx.db.insert("grants", {
				principal: identityB.tokenIdentifier,
				resourceKind: "snapshot",
				resourceId: alpha.summary.snapshotId,
				role: "reader",
				epoch: 1,
			}),
		);
		expect((await b.query(read, { request: request() })).content).toBeTruthy();
		await expect(
			b.mutation(put, { ...request(), bytes: original }),
		).rejects.toThrow("not_found");
	});

	it("rejects fabricated entry/blob/repository/commit/range in an owned snapshot", async () => {
		const { a } = await fixture();
		await a.mutation(put, { ...request(), bytes: original });
		const evidence = await a.query(read, { request: request() });
		const investigation = await a.mutation(
			api.investigations.openInvestigation,
			{
				request: {
					question: "Compare exact sources",
					snapshotIds: [alpha.summary.snapshotId],
					requestKey: "open-test-source",
				},
			},
		);
		for (const override of [
			{ entryId: "fabricated" },
			{ blobId: "b".repeat(40) },
			{ repositoryId: "beta" },
			{ commit: "a".repeat(40) },
			{ byteRange: { start: 0, end: original.byteLength + 1 } },
		]) {
			await expect(
				a.mutation(api.decisions.recordDecision, {
					request: {
						investigationId: investigation.investigationId,
						expectedRevision: 0,
						kind: "constraint",
						statement: "Keep exact sources",
						refs: [{ ...evidence.ref, ...override }],
						requestKey: "forged-ref-test",
					},
				}),
			).rejects.toThrow();
		}
		const saved = await a.mutation(api.decisions.recordDecision, {
			request: {
				investigationId: investigation.investigationId,
				expectedRevision: 0,
				kind: "constraint",
				statement: "Keep exact sources",
				refs: [evidence.ref],
				requestKey: "valid-ref-test",
			},
		});
		expect(saved.refs).toEqual([evidence.ref]);
	});
});
