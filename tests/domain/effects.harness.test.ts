import { describe, expect, it } from "vitest";
import {
	diffEffects,
	digestArguments,
	EffectLedger,
	emptySnapshot,
	instrumentDb,
	instrumentScheduler,
} from "../helpers/effects.ts";

/**
 * Tests the HARNESS, not the application. Layer: unit.
 *
 * These prove the instrument is trustworthy before anything is measured with it. They
 * say nothing about Q01, which stays NOT RUN until real handlers exist.
 */
describe("effect ledger", () => {
	it("tracks writes, jobs and dispatches on separate channels", () => {
		const ledger = new EffectLedger();
		const before = ledger.snapshot();

		ledger.recordWrite({
			table: "investigations",
			op: "insert",
			docId: "doc_1",
		});
		ledger.recordJob({
			jobId: "job_1",
			reference: "internal.analyze",
			runAtMs: 0,
		});
		ledger.recordDispatch({ provider: "p", model: "m", args: { a: 1 } });

		const diff = diffEffects(before, ledger.snapshot());
		expect(diff.counts).toEqual({
			writes: 1,
			committedWrites: 1,
			failedWrites: 0,
			jobs: 1,
			dispatches: 1,
		});
		expect(diff.clean).toBe(false);
	});

	it("reports clean when nothing happened", () => {
		const ledger = new EffectLedger();
		expect(diffEffects(emptySnapshot(), ledger.snapshot()).clean).toBe(true);
	});

	it("sees a job scheduled with no write - the denied-read-that-enqueued case", () => {
		const ledger = new EffectLedger();
		const before = ledger.snapshot();
		ledger.recordJob({
			jobId: "job_leak",
			reference: "internal.analyze",
			runAtMs: 0,
		});

		const diff = diffEffects(before, ledger.snapshot());
		expect(diff.counts.writes).toBe(0);
		expect(diff.counts.jobs).toBe(1);
		// The whole point: this must NOT read as clean just because no bytes were written.
		expect(diff.clean).toBe(false);
	});

	it("snapshots do not move after the fact", () => {
		const ledger = new EffectLedger();
		const before = ledger.snapshot();
		ledger.recordWrite({ table: "todos", op: "insert", docId: "doc_2" });
		expect(before.writes).toHaveLength(0);
		expect(ledger.snapshot().writes).toHaveLength(1);
	});

	it("reset clears every channel and starts a new generation", () => {
		const ledger = new EffectLedger();
		ledger.recordWrite({ table: "todos", op: "delete", docId: "doc_3" });
		ledger.recordJob({ jobId: "job_2", reference: "r", runAtMs: null });
		ledger.reset();

		const after = ledger.snapshot();
		expect(after.writes).toHaveLength(0);
		expect(after.jobs).toHaveLength(0);
		expect(after.dispatches).toHaveLength(0);

		// A post-reset window is clean only when measured from a post-reset baseline.
		// Diffing against a pre-reset snapshot is rejected, not silently reported clean.
		expect(diffEffects(after, ledger.snapshot()).clean).toBe(true);
		expect(() => diffEffects(emptySnapshot(), after)).toThrow(/generation/i);
	});
});

describe("argument digest", () => {
	it("is stable across key order", () => {
		expect(digestArguments({ a: 1, b: [2, 3] })).toBe(
			digestArguments({ b: [2, 3], a: 1 }),
		);
	});

	it("changes when an argument changes - Q07 depends on this", () => {
		expect(digestArguments({ a: 1 })).not.toBe(digestArguments({ a: 2 }));
	});

	it("respects array order", () => {
		expect(digestArguments([1, 2])).not.toBe(digestArguments([2, 1]));
	});

	it("never retains the payload", () => {
		const secret = "SYNTHETIC_SECRET_VALUE_0001";
		const ledger = new EffectLedger();
		ledger.recordDispatch({
			provider: "p",
			model: "m",
			args: { prompt: secret },
		});
		const serialized = JSON.stringify(ledger.snapshot());
		expect(serialized).not.toContain(secret);
		expect(serialized).toContain("sha256:");
	});
});

describe("instrumentation wrappers", () => {
	it("records db writes without changing the return value", () => {
		const ledger = new EffectLedger();
		const db = {
			insert: (_table: string, _doc: unknown) => "doc_inserted",
			patch: (_id: string, _doc: unknown) => undefined,
			get: (_id: string) => ({ ok: true }),
		};
		const wrapped = instrumentDb(
			db as unknown as Record<string, unknown>,
			ledger,
		) as typeof db;

		expect(wrapped.insert("investigations", { x: 1 })).toBe("doc_inserted");
		wrapped.patch("doc_inserted", { x: 2 });
		// Reads are not writes and must not be counted.
		expect(wrapped.get("doc_inserted")).toEqual({ ok: true });

		const snap = ledger.snapshot();
		expect(snap.writes).toMatchObject([
			{
				table: "investigations",
				op: "insert",
				docId: "doc_inserted",
				outcome: "committed",
			},
			{
				table: "unknown",
				op: "patch",
				docId: "doc_inserted",
				outcome: "committed",
			},
		]);
	});

	it("records scheduled jobs by opaque id only", async () => {
		const ledger = new EffectLedger();
		const scheduler = {
			runAfter: async (_ms: number, _ref: string, _args: unknown) => "job_abc",
		};
		const wrapped = instrumentScheduler(
			scheduler as unknown as Record<string, unknown>,
			ledger,
		) as typeof scheduler;

		await wrapped.runAfter(0, "internal.analyze", {
			secret: "SYNTHETIC_JOB_ARG_0001",
		});

		const jobs = ledger.snapshot().jobs;
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.jobId).toBe("job_abc");
		expect(JSON.stringify(jobs)).not.toContain("SYNTHETIC_JOB_ARG_0001");
	});
});
