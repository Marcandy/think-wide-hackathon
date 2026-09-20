import { describe, expect, it, vi } from 'vitest'
import { EffectLedger, diffEffects, instrumentDb } from '../helpers/effects.ts'
import { createDelayedProvider } from '../helpers/provider.ts'

/**
 * T04 — regressions for three harness defects found in review.
 *
 * Layer: unit. Every test here failed before the fix. They guard properties the rest of
 * the suite silently assumed, so a harness that reports "no effects" can be believed.
 */

describe('regression: asynchronous database writes', () => {
	it('records the resolved document id, not a stringified promise', async () => {
		const ledger = new EffectLedger()
		const db = { insert: async (_table: string, _doc: unknown) => 'doc_async_1' }
		const wrapped = instrumentDb(db as unknown as Record<string, unknown>, ledger) as typeof db

		const returned = await wrapped.insert('investigations', { x: 1 })

		// The wrapper must not change what the handler sees.
		expect(returned).toBe('doc_async_1')

		const writes = ledger.snapshot().writes
		expect(writes).toHaveLength(1)
		// Before the fix this was the string "[object Promise]".
		expect(writes[0]?.docId).toBe('doc_async_1')
		expect(writes[0]?.outcome).toBe('committed')
	})

	it('marks a rejected write as failed and re-throws the original error', async () => {
		const ledger = new EffectLedger()
		const boom = new Error('write conflict')
		const db = {
			insert: async (_table: string, _doc: unknown): Promise<string> => {
				throw boom
			},
		}
		const wrapped = instrumentDb(db as unknown as Record<string, unknown>, ledger) as typeof db

		await expect(wrapped.insert('investigations', { x: 1 })).rejects.toThrow('write conflict')

		const writes = ledger.snapshot().writes
		expect(writes).toHaveLength(1)
		expect(writes[0]?.outcome).toBe('failed')
	})

	it('separates attempted operations from committed ones', async () => {
		const ledger = new EffectLedger()
		const before = ledger.snapshot()
		const db = {
			insert: async (table: string, _doc: unknown): Promise<string> => {
				if (table === 'doomed') throw new Error('rejected by policy')
				return 'doc_ok'
			},
		}
		const wrapped = instrumentDb(db as unknown as Record<string, unknown>, ledger) as typeof db

		await wrapped.insert('investigations', {})
		await expect(wrapped.insert('doomed', {})).rejects.toThrow()

		const diff = diffEffects(before, ledger.snapshot())
		// Two calls were observed; only one became a committed effect. Neither number
		// alone proves a committed transaction, so both are reported.
		expect(diff.counts.writes).toBe(2)
		expect(diff.counts.committedWrites).toBe(1)
		expect(diff.clean).toBe(false)
	})

	it('still handles a synchronous insert', () => {
		const ledger = new EffectLedger()
		const db = { insert: (_table: string, _doc: unknown) => 'doc_sync_1' }
		const wrapped = instrumentDb(db as unknown as Record<string, unknown>, ledger) as typeof db

		expect(wrapped.insert('todos', { x: 1 })).toBe('doc_sync_1')
		const writes = ledger.snapshot().writes
		expect(writes[0]?.docId).toBe('doc_sync_1')
		expect(writes[0]?.outcome).toBe('committed')
	})

	it('records a write that is attempted but never awaited as not yet committed', async () => {
		const ledger = new EffectLedger()
		let release: (id: string) => void = () => {}
		const gate = new Promise<string>((resolve) => {
			release = resolve
		})
		const db = { insert: (_table: string, _doc: unknown) => gate }
		const wrapped = instrumentDb(db as unknown as Record<string, unknown>, ledger) as typeof db

		const inFlight = wrapped.insert('investigations', {})
		await Promise.resolve()

		// Observed immediately, but not yet a committed effect.
		expect(ledger.snapshot().writes[0]?.outcome).toBe('attempted')

		release('doc_late')
		await inFlight
		expect(ledger.snapshot().writes[0]?.outcome).toBe('committed')
		expect(ledger.snapshot().writes[0]?.docId).toBe('doc_late')
	})
})

describe('regression: provider call that genuinely stays pending', () => {
	it('does not settle until released, and records exactly one dispatch', async () => {
		const ledger = new EffectLedger()
		const provider = createDelayedProvider({ ledger, timeoutMs: 1_000 })
		const handle = provider.enqueuePending()

		const inFlight = provider.call({ args: { q: 'pending case' } })
		const observer = vi.fn()
		void inFlight.then(observer)

		await Promise.resolve()
		await Promise.resolve()

		expect(observer).not.toHaveBeenCalled()
		expect(provider.pendingCount()).toBe(1)
		expect(ledger.snapshot().dispatches).toHaveLength(1)

		// A later action happens while the provider call is still outstanding. This is
		// the shape of a stale result: work continues, then the old call comes back.
		ledger.recordWrite({ table: 'investigations', op: 'patch', docId: 'doc_correction' })

		handle.complete('late body')
		const outcome = await inFlight

		expect(outcome.kind).toBe('completed')
		if (outcome.kind === 'completed') expect(outcome.body).toBe('late body')
		// Releasing must not dispatch a second time.
		expect(ledger.snapshot().dispatches).toHaveLength(1)
		expect(provider.callCount()).toBe(1)
		expect(provider.pendingCount()).toBe(0)
	})

	it('lets a pending call fail after the fact without a second dispatch', async () => {
		const ledger = new EffectLedger()
		const provider = createDelayedProvider({ ledger, timeoutMs: 1_000 })
		const handle = provider.enqueuePending()
		const inFlight = provider.call({ args: { q: 'late failure' } })

		handle.fail('upstream reset')
		const outcome = await inFlight

		expect(outcome.kind).toBe('failed')
		expect(ledger.snapshot().dispatches).toHaveLength(1)
	})

	it('lets a pending call time out after dispatch, preserving the unknown outcome', async () => {
		const ledger = new EffectLedger()
		const provider = createDelayedProvider({ ledger, timeoutMs: 1_000 })
		const handle = provider.enqueuePending()
		const inFlight = provider.call({ args: { q: 'late timeout' } })

		handle.timeout()
		const outcome = await inFlight

		expect(outcome.kind).toBe('external_outcome_unknown')
		// Dispatched, unconfirmed. Reconcile; never blind-retry.
		expect(ledger.snapshot().dispatches).toHaveLength(1)
	})

	it('keeps the declared-latency timeout path working', async () => {
		const ledger = new EffectLedger()
		const provider = createDelayedProvider({ ledger, timeoutMs: 100 })
		provider.enqueue({ latencyMs: 5_000, result: { kind: 'completed', body: 'never seen' } })

		const outcome = await provider.call({ args: { q: 'virtual timeout' } })
		expect(outcome.kind).toBe('external_outcome_unknown')
		expect(ledger.snapshot().dispatches).toHaveLength(1)
	})
})

describe('regression: snapshots across a reset', () => {
	it('refuses to diff snapshots from different reset generations', () => {
		const ledger = new EffectLedger()
		ledger.recordWrite({ table: 'investigations', op: 'insert', docId: 'doc_before' })
		const before = ledger.snapshot()

		ledger.reset()
		ledger.recordWrite({ table: 'investigations', op: 'insert', docId: 'doc_after' })
		const after = ledger.snapshot()

		// Length-based slicing reported counts of zero and clean:true here, which would
		// let a real unauthorized write pass as "no effects observed".
		expect(() => diffEffects(before, after)).toThrow(/generation/i)
	})

	it('still diffs correctly within one generation', () => {
		const ledger = new EffectLedger()
		ledger.recordWrite({ table: 'a', op: 'insert', docId: 'doc_1' })
		const before = ledger.snapshot()
		ledger.recordWrite({ table: 'b', op: 'insert', docId: 'doc_2' })

		const diff = diffEffects(before, ledger.snapshot())
		expect(diff.counts.writes).toBe(1)
		expect(diff.writes[0]?.docId).toBe('doc_2')
		expect(diff.clean).toBe(false)
	})

	it('reports clean for a genuinely empty window', () => {
		const ledger = new EffectLedger()
		ledger.recordWrite({ table: 'a', op: 'insert', docId: 'doc_1' })
		const before = ledger.snapshot()
		expect(diffEffects(before, ledger.snapshot()).clean).toBe(true)
	})

	it('advances the generation on reset so stale snapshots are identifiable', () => {
		const ledger = new EffectLedger()
		const g0 = ledger.snapshot().generation
		ledger.reset()
		expect(ledger.snapshot().generation).toBe(g0 + 1)
	})
})
