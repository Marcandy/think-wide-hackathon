import type { EffectLedger, ProviderDispatch } from './effects.ts'
import { digestArguments } from './effects.ts'

/**
 * T04 · delayed provider stub with an observable dispatch effect.
 *
 * The behaviour that matters, from 04_BUILD_CONTRACT.md:
 *
 *   "A provider timeout after dispatch is external_outcome_unknown. Reconcile if
 *    possible; do not automatically submit another costly or state-changing request."
 *
 * So `external_outcome_unknown` is a THIRD outcome, not a flavour of failure. The
 * dispatch is recorded BEFORE the outcome is known, because a request that timed out was
 * still sent — that is the whole point, and it is what Q07 and Q12 reconcile against.
 *
 * Two delay modes, because they prove different things:
 *
 *   - `enqueue({ latencyMs, result })` — virtual latency, compared against the timeout
 *     and resolved immediately. Deterministic, no timers, no flakes.
 *   - `enqueuePending()` — the call genuinely does NOT settle until the returned handle
 *     is released. This is what a stale result looks like: the call is outstanding while
 *     other work proceeds, and only then comes back. A late result that must lose to a
 *     newer human correction (Q06) cannot be exercised without it.
 */

export type ProviderOutcome =
	| { readonly kind: 'completed'; readonly dispatchId: string; readonly body: string }
	| { readonly kind: 'failed'; readonly dispatchId: string; readonly error: string }
	| {
			readonly kind: 'external_outcome_unknown'
			readonly dispatchId: string
			/** Dispatched, no confirmed outcome. Reconcile; never blind-retry. */
			readonly elapsedMs: number | null
	  }

export type ScriptedResponse = {
	readonly latencyMs: number
	readonly result:
		| { readonly kind: 'completed'; readonly body: string }
		| { readonly kind: 'failed'; readonly error: string }
}

/** Releases a call that is deliberately left outstanding. */
export type PendingHandle = {
	complete: (body: string) => void
	fail: (error: string) => void
	/** Dispatched, then gave up waiting. Neither success nor failure. */
	timeout: () => void
	readonly settled: boolean
}

export type ProviderCall = {
	readonly provider?: string
	readonly model?: string
	readonly args: unknown
}

export type DelayedProvider = {
	/** Queues a response with virtual latency. Calls consume the queue in order. */
	enqueue: (response: ScriptedResponse) => void
	/** Queues a call that stays pending until the returned handle releases it. */
	enqueuePending: () => PendingHandle
	call: (input: ProviderCall) => Promise<ProviderOutcome>
	/** Every dispatch this stub made, including ones that timed out or are outstanding. */
	dispatches: () => readonly ProviderDispatch[]
	callCount: () => number
	/** Calls dispatched but not yet settled. */
	pendingCount: () => number
}

type Settlement =
	| { kind: 'completed'; body: string }
	| { kind: 'failed'; error: string }
	| { kind: 'external_outcome_unknown' }

type QueueEntry = { kind: 'scripted'; response: ScriptedResponse } | { kind: 'pending'; wait: Promise<Settlement> }

export function createDelayedProvider(config: {
	ledger: EffectLedger
	timeoutMs: number
	defaultProvider?: string
	defaultModel?: string
	/** Used when the queue is empty. Defaults to an immediate completion. */
	fallback?: ScriptedResponse
}): DelayedProvider {
	const queue: QueueEntry[] = []
	const made: ProviderDispatch[] = []
	let calls = 0
	let pending = 0

	const provider = config.defaultProvider ?? 'fixture-provider'
	const model = config.defaultModel ?? 'fixture-model-v0'
	const fallback: ScriptedResponse = config.fallback ?? {
		latencyMs: 0,
		result: { kind: 'completed', body: 'SYNTHETIC_PROVIDER_BODY' },
	}

	function toOutcome(settlement: Settlement, dispatchId: string): ProviderOutcome {
		if (settlement.kind === 'completed') return { kind: 'completed', dispatchId, body: settlement.body }
		if (settlement.kind === 'failed') return { kind: 'failed', dispatchId, error: settlement.error }
		return { kind: 'external_outcome_unknown', dispatchId, elapsedMs: null }
	}

	return {
		enqueue(response) {
			queue.push({ kind: 'scripted', response })
		},

		enqueuePending() {
			let release: (s: Settlement) => void = () => {}
			const wait = new Promise<Settlement>((resolve) => {
				release = resolve
			})
			queue.push({ kind: 'pending', wait })

			let settled = false
			const settleOnce = (s: Settlement) => {
				if (settled) return
				settled = true
				release(s)
			}
			return {
				complete: (body: string) => settleOnce({ kind: 'completed', body }),
				fail: (error: string) => settleOnce({ kind: 'failed', error }),
				timeout: () => settleOnce({ kind: 'external_outcome_unknown' }),
				get settled() {
					return settled
				},
			}
		},

		async call(input) {
			calls += 1
			const digest = digestArguments(input.args)
			// Recorded first, exactly once: a request that never returns was still sent.
			const dispatch = config.ledger.recordDispatch({
				provider: input.provider ?? provider,
				model: input.model ?? model,
				digest,
			})
			made.push(dispatch)
			const dispatchId = `${digest}#${calls}`

			const entry = queue.shift() ?? { kind: 'scripted' as const, response: fallback }

			if (entry.kind === 'pending') {
				pending += 1
				try {
					return toOutcome(await entry.wait, dispatchId)
				} finally {
					pending -= 1
				}
			}

			const scripted = entry.response
			if (scripted.latencyMs > config.timeoutMs) {
				return { kind: 'external_outcome_unknown', dispatchId, elapsedMs: config.timeoutMs }
			}
			if (scripted.result.kind === 'failed') {
				return { kind: 'failed', dispatchId, error: scripted.result.error }
			}
			return { kind: 'completed', dispatchId, body: scripted.result.body }
		},

		dispatches() {
			return Object.freeze([...made])
		},

		callCount() {
			return calls
		},

		pendingCount() {
			return pending
		},
	}
}
