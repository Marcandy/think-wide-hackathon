import { describe, expect, it } from 'vitest'
import { QCaseRegistry, registerAndrewCases } from '../helpers/qcases.ts'

function freshRegistry() {
	return registerAndrewCases(
		new QCaseRegistry({ tester: 'andrew', commitConfig: 'fixture-config' }),
	)
}

/** Layer: unit. The reporting guard itself. */
describe('q-case registry', () => {
	it('registers every case in Andrew’s lane as NOT RUN', () => {
		const registry = freshRegistry()
		const ids = registry.rows().map((r) => r.case)
		expect(ids).toEqual(['Q01', 'Q04', 'Q05', 'Q06', 'Q07', 'Q13', 'Q15'])
		expect(registry.notRun()).toHaveLength(ids.length)
	})

	it('keeps Q01 and Q04 NOT RUN at this commit', () => {
		// convex/schema.ts still holds scaffold products/todos; core/, contracts/ and
		// generated/ are empty. There is no handler to exercise, so a pass here would be
		// fabricated.
		const registry = freshRegistry()
		expect(registry.get('Q01').status).toBe('NOT RUN')
		expect(registry.get('Q04').status).toBe('NOT RUN')
	})

	it('refuses a PASS without an observed result', () => {
		const registry = freshRegistry()
		expect(() =>
			registry.observe('Q01', {
				layer: 'unit',
				observed: '',
				command: 'bunx vitest run',
				status: 'PASS',
			}),
		).toThrow(/observed result/)
	})

	it('refuses a PASS without the actual command', () => {
		const registry = freshRegistry()
		expect(() =>
			registry.observe('Q01', {
				layer: 'unit',
				observed: 'denied, zero jobs',
				command: '   ',
				status: 'PASS',
			}),
		).toThrow(/actual command/)
	})

	it('refuses N/A without an explicitly removed feature', () => {
		const registry = freshRegistry()
		expect(() =>
			registry.observe('Q15', {
				layer: 'live',
				observed: 'no provider credential',
				command: 'n/a',
				status: 'N/A',
			}),
		).toThrow(/removed feature/)
	})

	it('allows BLOCKED and NOT ASSESSED without a result, since neither claims a pass', () => {
		const registry = freshRegistry()
		expect(
			registry.observe('Q15', {
				layer: 'live',
				observed: '',
				command: '',
				status: 'BLOCKED',
				nextAction: 'needs T08/T09/T10',
			}).status,
		).toBe('BLOCKED')
		expect(
			registry.observe('Q13', { layer: 'unit', observed: '', command: '', status: 'NOT ASSESSED' }).status,
		).toBe('NOT ASSESSED')
	})

	it('accepts a complete observation', () => {
		const registry = freshRegistry()
		const row = registry.observe('Q05', {
			layer: 'unit',
			observed: 'harness fixtures materialize and hash as declared',
			command: 'bunx vitest run tests/domain/repo.fixtures.test.ts',
			status: 'PASS',
			artifact: 'evidence/t04/vitest.txt',
			nextAction: 'bind to analyzer in T07',
		})
		expect(row.status).toBe('PASS')
		expect(row.layer).toBe('unit')
		expect(registry.notRun().map((r) => r.case)).not.toContain('Q05')
	})

	it('rejects a duplicate registration', () => {
		const registry = freshRegistry()
		expect(() => registry.register('Q01', { expected: 'x' })).toThrow(/duplicate/)
	})

	it('rejects an observation for an unregistered case', () => {
		const registry = freshRegistry()
		expect(() =>
			registry.observe('Q99', { layer: 'unit', observed: 'x', command: 'y', status: 'PASS' }),
		).toThrow(/not registered/)
	})

	it('emits the full nine-field receipt shape', () => {
		const registry = freshRegistry()
		const row = registry.get('Q01')
		expect(Object.keys(row).sort()).toEqual(
			[
				'artifact',
				'case',
				'command',
				'commitConfig',
				'expected',
				'layer',
				'nextAction',
				'observed',
				'status',
				'tester',
			].sort(),
		)
	})

	it('renders a markdown table T11 can inherit', () => {
		const md = freshRegistry().toMarkdown()
		expect(md.split('\n')).toHaveLength(2 + 7)
		expect(md).toContain('| Q01 |')
		expect(md).toContain('NOT RUN')
	})
})
