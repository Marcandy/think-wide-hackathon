import { describe, expect, it } from 'vitest'
import {
	FIXTURE_NOW_MS,
	GRANTS,
	GRANT_A,
	GRANT_A_EXPIRED,
	GRANT_B,
	PRINCIPALS,
	PRINCIPAL_A,
	PRINCIPAL_B,
	grantsFor,
} from '../fixtures/identities.ts'
import {
	ACCESS_EXPECTATIONS,
	DENIAL_EXPECTATIONS,
	POSITIVE_CONTROLS,
} from '../fixtures/expectations.ts'

/**
 * Layer: unit. Asserts the FIXTURES and EXPECTATIONS are shaped so the real policy can
 * be tested honestly. This does not test authorization — no authorization code exists
 * yet, and Q01 stays NOT RUN.
 */
describe('A/B identity fixtures', () => {
	it('puts A and B in separate workspaces', () => {
		expect(PRINCIPAL_A.workspace).not.toBe(PRINCIPAL_B.workspace)
		expect(GRANT_A.workspace).toBe(PRINCIPAL_A.workspace)
		expect(GRANT_B.workspace).toBe(PRINCIPAL_B.workspace)
	})

	it('keeps A and B grants fully disjoint', () => {
		expect(GRANT_A.sourceId).not.toBe(GRANT_B.sourceId)
		expect(GRANT_A.investigationId).not.toBe(GRANT_B.investigationId)
		expect(grantsFor('principal-b').some((g) => g.sourceId === GRANT_A.sourceId)).toBe(false)
		expect(grantsFor('principal-a').some((g) => g.sourceId === GRANT_B.sourceId)).toBe(false)
	})

	it('gives the two principals distinct subjects under one trusted issuer', () => {
		expect(new Set(PRINCIPALS.map((p) => p.subject)).size).toBe(PRINCIPALS.length)
		expect(new Set(PRINCIPALS.map((p) => p.issuer)).size).toBe(1)
		expect(new Set(PRINCIPALS.map((p) => p.audience)).size).toBe(1)
	})

	it('has an expired grant that is actually expired against the fixture clock', () => {
		expect(GRANT_A_EXPIRED.notAfterMs).toBeLessThan(FIXTURE_NOW_MS)
		expect(GRANT_A.notAfterMs).toBeGreaterThan(FIXTURE_NOW_MS)
		expect(GRANT_B.notAfterMs).toBeGreaterThan(FIXTURE_NOW_MS)
	})

	it('exposes no decision function anywhere in the fixtures', () => {
		// A fixture that could answer "allowed?" would be the mock the ticket forbids.
		for (const grant of GRANTS) {
			for (const value of Object.values(grant)) expect(typeof value).not.toBe('function')
		}
	})
})

describe('independent access expectations', () => {
	it('orders the positive controls before every denial case', () => {
		// "A denial suite that never proved the allow path is not evidence."
		const firstDenial = ACCESS_EXPECTATIONS.findIndex((e) => e.expected === 'deny')
		const lastAllow = ACCESS_EXPECTATIONS.map((e) => e.expected).lastIndexOf('allow')
		expect(lastAllow).toBeLessThan(firstDenial)
		expect(ACCESS_EXPECTATIONS[0]?.id).toBe('A-reads-A')
		expect(ACCESS_EXPECTATIONS[1]?.id).toBe('B-reads-B')
	})

	it('covers positive controls, foreign-ID substitution and expiry', () => {
		expect(new Set(ACCESS_EXPECTATIONS.map((e) => e.kind))).toEqual(
			new Set(['positive-control', 'foreign-id-substitution', 'expired-grant']),
		)
		expect(POSITIVE_CONTROLS).toHaveLength(2)
		expect(DENIAL_EXPECTATIONS.length).toBeGreaterThanOrEqual(3)
	})

	it('expects zero effects on every denial, not merely denied bytes', () => {
		for (const e of DENIAL_EXPECTATIONS) {
			expect(e.expectedEffects, `${e.id} must expect no side effects`).toEqual({
				writes: 0,
				jobs: 0,
				dispatches: 0,
			})
		}
	})

	it('never lets a denial case reference only objects the actor already holds', () => {
		for (const e of DENIAL_EXPECTATIONS.filter((e) => e.kind === 'foreign-id-substitution')) {
			const held = grantsFor(e.principal)
			const ownsSource = held.some((g) => g.sourceId === e.presentedSourceId)
			const ownsInvestigation = held.some((g) => g.investigationId === e.presentedInvestigationId)
			expect(ownsSource && ownsInvestigation, `${e.id} must reference a foreign object`).toBe(false)
		}
	})

	it('points every positive control at objects the actor genuinely holds', () => {
		for (const e of POSITIVE_CONTROLS) {
			const held = grantsFor(e.principal)
			expect(held.some((g) => g.sourceId === e.presentedSourceId), e.id).toBe(true)
			expect(held.some((g) => g.investigationId === e.presentedInvestigationId), e.id).toBe(true)
		}
	})

	it('states outcomes as data only, with no decision function', () => {
		for (const e of ACCESS_EXPECTATIONS) {
			for (const value of Object.values(e)) expect(typeof value).not.toBe('function')
		}
	})

	it('has unique expectation ids', () => {
		const ids = ACCESS_EXPECTATIONS.map((e) => e.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})
