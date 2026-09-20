import { describe, expect, it } from "vitest";
import { digestArguments, EffectLedger } from "../helpers/effects.ts";
import { createDelayedProvider } from "../helpers/provider.ts";

/** Layer: unit. Harness behaviour only; Q07 and Q12 stay NOT RUN. */
describe("delayed provider stub", () => {
	it("completes within the timeout", async () => {
		const ledger = new EffectLedger();
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 });
		provider.enqueue({
			latencyMs: 10,
			result: { kind: "completed", body: "ok" },
		});

		const outcome = await provider.call({ args: { q: "positive control" } });
		expect(outcome.kind).toBe("completed");
		expect(ledger.snapshot().dispatches).toHaveLength(1);
	});

	it("reports external_outcome_unknown on timeout, not failure", async () => {
		const ledger = new EffectLedger();
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 });
		provider.enqueue({
			latencyMs: 5_000,
			result: { kind: "completed", body: "never seen" },
		});

		const outcome = await provider.call({ args: { q: "timeout case" } });
		expect(outcome.kind).toBe("external_outcome_unknown");
		expect(outcome.kind).not.toBe("failed");
	});

	it("still records the dispatch when the outcome is unknown", async () => {
		const ledger = new EffectLedger();
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 });
		provider.enqueue({
			latencyMs: 5_000,
			result: { kind: "completed", body: "never seen" },
		});

		await provider.call({ args: { q: "timeout case" } });

		// Dispatched but unconfirmed. Reconcile; do not blind-retry.
		expect(ledger.snapshot().dispatches).toHaveLength(1);
		expect(provider.callCount()).toBe(1);
	});

	it("distinguishes a declared failure from an unknown outcome", async () => {
		const ledger = new EffectLedger();
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 });
		provider.enqueue({
			latencyMs: 1,
			result: { kind: "failed", error: "upstream 500" },
		});

		const outcome = await provider.call({ args: { q: "failure case" } });
		expect(outcome.kind).toBe("failed");
	});

	it("digests arguments and keeps the payload out of the ledger", async () => {
		const ledger = new EffectLedger();
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 });
		const args = { prompt: "SYNTHETIC_PROMPT_BODY_0001" };

		await provider.call({ args });

		const dispatches = ledger.snapshot().dispatches;
		expect(dispatches[0]?.argumentDigest).toBe(digestArguments(args));
		expect(JSON.stringify(dispatches)).not.toContain(
			"SYNTHETIC_PROMPT_BODY_0001",
		);
	});

	it("gives the same key with changed arguments a different digest", async () => {
		const ledger = new EffectLedger();
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 });

		await provider.call({ args: { key: "k1", value: 1 } });
		await provider.call({ args: { key: "k1", value: 2 } });

		const [first, second] = ledger.snapshot().dispatches;
		expect(first?.argumentDigest).not.toBe(second?.argumentDigest);
	});
});
