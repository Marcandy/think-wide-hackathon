import {
	INVESTIGATION_A,
	INVESTIGATION_A_EXPIRED,
	INVESTIGATION_B,
	SOURCE_A,
	SOURCE_A_EXPIRED,
	SOURCE_B,
} from './identities.ts'
import type { PrincipalId, Scope } from './identities.ts'

/**
 * T04 — who may read what, written independently of the implementation (issue #4).
 *
 * This file is deliberately separate from identities.ts. identities.ts describes WHO
 * EXISTS and WHAT THEY HOLD; this file states WHAT SHOULD HAPPEN. Neither one decides.
 *
 * HARD RULE from the ticket and 05_SECURITY_AND_CI.md:
 *   "No mock that replaces authorization with an assumed deny."
 *
 * These are independently authored expectations to compare the real policy's decision
 * against. Nothing here is importable by, or consulted by, a production path — if the
 * implementation ever imports this file, the test is grading its own answer key.
 *
 * Ordering matters and is asserted by the boundary suite: the A -> A and B -> B positive
 * controls come first. A denial suite that never proved the allow path is not evidence.
 */

export type ExpectedDecision = 'allow' | 'deny'

/** On any outcome these must hold, checked against the effect ledger, not the response body. */
export type ExpectedEffects = {
	readonly writes: number
	readonly jobs: number
	readonly dispatches: number
}

export type AccessExpectation = {
	readonly id: string
	readonly qcase: 'Q01'
	readonly kind: 'positive-control' | 'foreign-id-substitution' | 'expired-grant'
	readonly principal: PrincipalId
	/** What the caller PRESENTS. An ID is an address, not a permission. */
	readonly presentedSourceId: string
	readonly presentedInvestigationId: string
	readonly scope: Scope
	readonly expected: ExpectedDecision
	readonly expectedEffects: ExpectedEffects
	readonly rationale: string
}

/** A read is a read. Nothing it does should write, schedule or call a provider. */
const NO_EFFECTS: ExpectedEffects = Object.freeze({ writes: 0, jobs: 0, dispatches: 0 })

export const ACCESS_EXPECTATIONS: readonly AccessExpectation[] = Object.freeze([
	Object.freeze({
		id: 'A-reads-A',
		qcase: 'Q01',
		kind: 'positive-control',
		principal: 'principal-a',
		presentedSourceId: SOURCE_A,
		presentedInvestigationId: INVESTIGATION_A,
		scope: 'read:bytes',
		expected: 'allow',
		expectedEffects: NO_EFFECTS,
		rationale: 'Current grant, own source and own investigation. Proves the allow path exists at all.',
	}),
	Object.freeze({
		id: 'B-reads-B',
		qcase: 'Q01',
		kind: 'positive-control',
		principal: 'principal-b',
		presentedSourceId: SOURCE_B,
		presentedInvestigationId: INVESTIGATION_B,
		scope: 'read:bytes',
		expected: 'allow',
		expectedEffects: NO_EFFECTS,
		rationale: 'Independent grant from A. Proves the two principals are genuinely separate.',
	}),
	Object.freeze({
		id: 'B-substitutes-A-source',
		qcase: 'Q01',
		kind: 'foreign-id-substitution',
		principal: 'principal-b',
		presentedSourceId: SOURCE_A,
		presentedInvestigationId: INVESTIGATION_B,
		scope: 'read:bytes',
		expected: 'deny',
		expectedEffects: NO_EFFECTS,
		rationale:
			'B holds a valid session and substitutes the source ID of A. Operation permission is not object permission.',
	}),
	Object.freeze({
		id: 'B-substitutes-A-investigation',
		qcase: 'Q01',
		kind: 'foreign-id-substitution',
		principal: 'principal-b',
		presentedSourceId: SOURCE_B,
		presentedInvestigationId: INVESTIGATION_A,
		scope: 'read:investigation',
		expected: 'deny',
		expectedEffects: NO_EFFECTS,
		rationale: 'Every referenced object is checked, not only the outer investigation.',
	}),
	Object.freeze({
		id: 'B-substitutes-both-A-ids',
		qcase: 'Q01',
		kind: 'foreign-id-substitution',
		principal: 'principal-b',
		presentedSourceId: SOURCE_A,
		presentedInvestigationId: INVESTIGATION_A,
		scope: 'read:bytes',
		expected: 'deny',
		expectedEffects: NO_EFFECTS,
		rationale: 'A self-consistent foreign pair still fails: internal consistency is not authority.',
	}),
	Object.freeze({
		id: 'A-expired-grant',
		qcase: 'Q01',
		kind: 'expired-grant',
		principal: 'principal-a',
		presentedSourceId: SOURCE_A_EXPIRED,
		presentedInvestigationId: INVESTIGATION_A_EXPIRED,
		scope: 'read:bytes',
		expected: 'deny',
		expectedEffects: NO_EFFECTS,
		rationale: 'Correct principal, correct objects, lapsed grant. Must fail closed on freshness.',
	}),
])

export function expectationById(id: string): AccessExpectation {
	const found = ACCESS_EXPECTATIONS.find((e) => e.id === id)
	if (!found) throw new Error(`unknown access expectation: ${id}`)
	return found
}

export const POSITIVE_CONTROLS: readonly AccessExpectation[] = Object.freeze(
	ACCESS_EXPECTATIONS.filter((e) => e.expected === 'allow'),
)

export const DENIAL_EXPECTATIONS: readonly AccessExpectation[] = Object.freeze(
	ACCESS_EXPECTATIONS.filter((e) => e.expected === 'deny'),
)
