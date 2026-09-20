/**
 * T04 · S4 — evidence receipt emitter.
 *
 * Shape is fixed by 05_SECURITY_AND_CI.md "Minimal evidence receipt":
 *   task/case · tester · commit/config/image · layer (unit|local|live|deployed) ·
 *   expected and observed effects · actual command · status · sanitized artifact
 *   location · next action.
 *
 * Two rules are enforced in code rather than left to discipline, because both were
 * named as failure modes in the brief:
 *
 *   1. Every case starts NOT RUN and can only leave NOT RUN with an actual observed
 *      result AND the actual command that produced it. That is the fabricated-pass
 *      guard.
 *   2. N/A requires an explicitly removed feature. An unavailable credential is
 *      BLOCKED, and an unsupported input is NOT ASSESSED. Neither is "clean".
 *
 * T11 consumes these rows directly instead of rebuilding reporting.
 *
 * WHAT THIS HELPER CANNOT DO, and must not be described as doing:
 * it checks that an observed result and a command string are PRESENT. It cannot verify
 * that either is truthful, cannot tell a unit-layer harness result from a real-handler
 * result, and cannot enforce that a real handler ran at all. The `layer` field is
 * self-reported. A row saying PASS at layer "local" is a claim by the tester, not
 * evidence produced by this code. Reviewer acceptance, not this guard, is what makes a
 * row trustworthy.
 */

export type Layer = 'unit' | 'local' | 'live' | 'deployed'

export type Status = 'NOT RUN' | 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT ASSESSED' | 'N/A'

export type Receipt = {
	readonly case: string
	readonly tester: string
	readonly commitConfig: string
	readonly layer: Layer | null
	readonly expected: string
	readonly observed: string
	readonly command: string
	readonly status: Status
	readonly artifact: string
	readonly nextAction: string
}

export type Observation = {
	readonly layer: Layer
	readonly observed: string
	readonly command: string
	readonly status: Exclude<Status, 'NOT RUN'>
	readonly artifact?: string
	readonly nextAction?: string
	/** Required when status is 'N/A': which feature was explicitly removed. */
	readonly removedFeature?: string
}

const RESULT_STATUSES: readonly Status[] = ['PASS', 'FAIL']

export class QCaseRegistry {
	readonly tester: string
	readonly commitConfig: string
	#rows = new Map<string, Receipt>()

	constructor(input: { tester: string; commitConfig: string }) {
		this.tester = input.tester
		this.commitConfig = input.commitConfig
	}

	/** Registers a case in the NOT RUN state. Idempotent per case id. */
	register(caseId: string, input: { expected: string; nextAction?: string }): Receipt {
		if (this.#rows.has(caseId)) throw new Error(`duplicate q-case registration: ${caseId}`)
		const row: Receipt = Object.freeze({
			case: caseId,
			tester: this.tester,
			commitConfig: this.commitConfig,
			layer: null,
			expected: input.expected,
			observed: '',
			command: '',
			status: 'NOT RUN',
			artifact: '',
			nextAction: input.nextAction ?? '',
		})
		this.#rows.set(caseId, row)
		return row
	}

	observe(caseId: string, obs: Observation): Receipt {
		const current = this.#rows.get(caseId)
		if (!current) throw new Error(`q-case not registered: ${caseId}`)

		if (RESULT_STATUSES.includes(obs.status)) {
			if (!obs.observed.trim()) {
				throw new Error(`${caseId}: ${obs.status} requires an observed result, not an assumption`)
			}
			if (!obs.command.trim()) {
				throw new Error(`${caseId}: ${obs.status} requires the actual command that produced it`)
			}
		}
		if (obs.status === 'N/A' && !obs.removedFeature?.trim()) {
			throw new Error(
				`${caseId}: N/A requires an explicitly removed feature. An unavailable credential is BLOCKED.`,
			)
		}

		const row: Receipt = Object.freeze({
			...current,
			layer: obs.layer,
			observed: obs.status === 'N/A' ? `removed feature: ${obs.removedFeature}` : obs.observed,
			command: obs.command,
			status: obs.status,
			artifact: obs.artifact ?? '',
			nextAction: obs.nextAction ?? current.nextAction,
		})
		this.#rows.set(caseId, row)
		return row
	}

	get(caseId: string): Receipt {
		const row = this.#rows.get(caseId)
		if (!row) throw new Error(`q-case not registered: ${caseId}`)
		return row
	}

	rows(): readonly Receipt[] {
		return Object.freeze([...this.#rows.values()])
	}

	notRun(): readonly Receipt[] {
		return this.rows().filter((r) => r.status === 'NOT RUN')
	}

	toJSON(): readonly Receipt[] {
		return this.rows()
	}

	toMarkdown(): string {
		const header =
			'| case | tester | commit/config | layer | expected | observed | command | status | artifact | next action |'
		const rule = '|---|---|---|---|---|---|---|---|---|---|'
		const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
		const body = this.rows().map((r) =>
			[
				'',
				cell(r.case),
				cell(r.tester),
				cell(r.commitConfig),
				cell(r.layer ?? '-'),
				cell(r.expected),
				cell(r.observed || '-'),
				cell(r.command || '-'),
				cell(r.status),
				cell(r.artifact || '-'),
				cell(r.nextAction || '-'),
				'',
			].join(' | ').trim(),
		)
		return [header, rule, ...body].join('\n')
	}
}

/**
 * The cases in Andrew's lane. Registered NOT RUN on construction.
 *
 * Q01 and Q04 cannot leave NOT RUN at this commit: convex/schema.ts still holds the
 * scaffold products/todos tables and core/, contracts/ and generated/ are empty, so
 * there is no real handler to exercise. Anything else here would be a fabricated pass.
 */
export function registerAndrewCases(registry: QCaseRegistry): QCaseRegistry {
	registry.register('Q01', {
		expected:
			'A reads A and B reads B allowed; B substituting an ID of A denied with unchanged business state and zero job/provider dispatch',
		nextAction: 'Bind to real handlers after T02/T06 land',
	})
	registry.register('Q04', {
		expected:
			'Exact byte window, Unicode and CRLF/LF, stale branch, missing blob, symlink escape and path injection each return matching hashes or an explicit unavailable/rejected response',
		nextAction: 'Bind to the analyzer after T05/T06 land',
	})
	registry.register('Q05', {
		expected:
			'Literal and structural fixtures produce positive and negative matches with an evidence-class label, exact refs and a coverage status',
		nextAction: 'T07',
	})
	registry.register('Q06', {
		expected: 'Late proposal at revision N after a human correction at N+1 is rejected; reopened view is correct',
		nextAction: 'T11',
	})
	registry.register('Q07', {
		expected:
			'Duplicate command admits one business transition; same key with changed arguments returns an explicit conflict',
		nextAction: 'T11',
	})
	registry.register('Q13', {
		expected:
			'Analyzer attempts at forbidden file/network/write are denied; time and output limits hold; source is unchanged',
		nextAction: 'T07',
	})
	registry.register('Q15', {
		expected:
			'Two synthetic repos drive question, correction, changed result, reopen and brief end to end at a recorded commit/config',
		nextAction: 'T11',
	})
	return registry
}
