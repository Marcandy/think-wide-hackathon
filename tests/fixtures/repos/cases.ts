import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * T04 · S3 — content and expectations for the two synthetic fixture repos (Q04).
 *
 * This file is the single source of truth for what goes INTO the fixture repos.
 * scripts/make-fixture-repos.ts reads it to build them; tests/domain/q04-exact-bytes.test.ts
 * restores the bundles and asserts the bytes that come back match what is declared here.
 * That is the point of the round trip: it proves a bundle restoration is lossless, not
 * merely that two constants in one file agree with each other.
 *
 * Everything is CLEARLY SYNTHETIC and operator-authored. No ingested third-party source.
 *
 * .gitattributes marks `tests/fixtures/** -text`, so the committed bundles are never
 * rewritten by git on any platform, and the CRLF fixture stays CRLF.
 */

export const REPOS_DIR = dirname(fileURLToPath(import.meta.url))

export type RepoName = 'alpha' | 'beta'

export function sha256(input: string | Uint8Array): string {
	return `sha256:${createHash('sha256').update(input).digest('hex')}`
}

/** First revision of alpha's source. Superseded by ALPHA_TS; kept for the stale-ref case. */
export const ALPHA_TS_V1 = [
	'// SYNTHETIC FIXTURE - not real source. T04/Q04.',
	'export function alphaMarker(): string {',
	"\treturn 'SYNTHETIC_ALPHA_MARKER_V1'",
	'}',
	'',
].join('\n')

/** Current revision of alpha's source. ASCII, LF only - the baseline for byte windows. */
export const ALPHA_TS = [
	'// SYNTHETIC FIXTURE - not real source. T04/Q04.',
	'export function alphaMarker(): string {',
	"\treturn 'SYNTHETIC_ALPHA_MARKER_0001'",
	'}',
	'',
	'export const ALPHA_EDGE = 0',
	'',
].join('\n')

/**
 * The same logical text in two newline encodings, plus non-ASCII: a combining sequence,
 * a non-BMP emoji (surrogate pair in UTF-16, four bytes in UTF-8) and CJK characters.
 * An implementation that slices by JS string index instead of byte offset makes the LF
 * and CRLF cases disagree, and the test catches it.
 */
const UNICODE_LINES = [
	'// SYNTHETIC FIXTURE - unicode probe',
	'const cafe = "cafe\u0301"',
	'const emoji = "\u{1F9EA}"',
	'const cjk = "\u6F22\u5B57"',
	'',
]

export const UNICODE_LF = UNICODE_LINES.join('\n')
export const UNICODE_CRLF = UNICODE_LINES.join('\r\n')

/**
 * Byte offset of the four-byte emoji inside the LF variant, computed rather than
 * hardcoded so the split-window case cannot quietly stop splitting anything when the
 * fixture text is edited.
 */
export const EMOJI_BYTE_START = Buffer.from(UNICODE_LF, 'utf8').indexOf(
	Buffer.from('\u{1F9EA}', 'utf8'),
)

export const BETA_TS = [
	'// SYNTHETIC FIXTURE - second repo, independent of alpha. T04/Q15.',
	'export function betaMarker(): string {',
	"\treturn 'SYNTHETIC_BETA_MARKER_0001'",
	'}',
	'',
].join('\n')

/** Committed as a real symlink (mode 120000) that resolves outside the repo root. */
export const ESCAPE_LINK_PATH = 'src/escape-link.txt'
export const ESCAPE_LINK_TARGET = '../../../../etc/passwd'

export type FixtureFile = {
	readonly repo: RepoName
	readonly path: string
	readonly content: string
	readonly byteLength: number
	readonly sha256: string
}

function file(repo: RepoName, path: string, content: string): FixtureFile {
	const bytes = Buffer.from(content, 'utf8')
	return Object.freeze({ repo, path, content, byteLength: bytes.byteLength, sha256: sha256(bytes) })
}

export const FIXTURE_FILES: readonly FixtureFile[] = Object.freeze([
	file('alpha', 'src/alpha.ts', ALPHA_TS),
	file('alpha', 'src/unicode-lf.txt', UNICODE_LF),
	file('alpha', 'src/unicode-crlf.txt', UNICODE_CRLF),
	file('beta', 'lib/beta.ts', BETA_TS),
])

export function fixtureFile(path: string): FixtureFile {
	const found = FIXTURE_FILES.find((f) => f.path === path)
	if (!found) throw new Error(`unknown fixture file: ${path}`)
	return found
}

/** Byte offsets, half-open [startByte, endByte). Not character offsets. */
export type ByteRange = { readonly startByte: number; readonly endByte: number }

export type ExpectedOutcome =
	| { readonly kind: 'bytes'; readonly sha256: string; readonly byteLength: number }
	/** The reference cannot be served. Explicitly unavailable - never a silent fallback. */
	| { readonly kind: 'unavailable'; readonly reason: 'stale_ref' | 'missing_blob' }
	/** Malformed or escaping. Rejected before any read. */
	| { readonly kind: 'rejected'; readonly reason: 'path_escape' | 'path_injection' }

export type ByteCase = {
	readonly id: string
	readonly qcase: 'Q04'
	readonly repo: RepoName
	/** 'head' resolves to the current commit; 'stale' to the superseded first commit. */
	readonly revision: 'head' | 'stale'
	readonly path: string
	readonly range: ByteRange | null
	readonly expected: ExpectedOutcome
	readonly rationale: string
}

function windowOf(path: string, startByte: number, endByte: number): ExpectedOutcome {
	const bytes = Buffer.from(fixtureFile(path).content, 'utf8').subarray(startByte, endByte)
	return Object.freeze({ kind: 'bytes' as const, sha256: sha256(bytes), byteLength: bytes.byteLength })
}

function whole(path: string): ExpectedOutcome {
	const f = fixtureFile(path)
	return Object.freeze({ kind: 'bytes' as const, sha256: f.sha256, byteLength: f.byteLength })
}

export const BYTE_CASES: readonly ByteCase[] = Object.freeze([
	Object.freeze({
		id: 'whole-file-positive-control',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: 'src/alpha.ts',
		range: null,
		expected: whole('src/alpha.ts'),
		rationale: 'Positive control for the byte path, proved before any boundary case.',
	}),
	Object.freeze({
		id: 'exact-byte-window',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: 'src/alpha.ts',
		range: Object.freeze({ startByte: 48, endByte: 84 }),
		expected: windowOf('src/alpha.ts', 48, 84),
		rationale: 'A bounded window returns exactly those bytes, not the whole file or a padded line.',
	}),
	Object.freeze({
		id: 'window-crossing-multibyte',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: 'src/unicode-lf.txt',
		range: Object.freeze({ startByte: 0, endByte: 64 }),
		expected: windowOf('src/unicode-lf.txt', 0, 64),
		rationale: 'A byte window may split a multi-byte character; the result must still be exact.',
	}),
	Object.freeze({
		id: 'window-crlf-variant',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: 'src/unicode-crlf.txt',
		range: Object.freeze({ startByte: 0, endByte: 64 }),
		expected: windowOf('src/unicode-crlf.txt', 0, 64),
		rationale: 'Same window, CRLF encoding. Must differ from LF - proves byte, not line, addressing.',
	}),
	Object.freeze({
		id: 'window-splits-multibyte',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: 'src/unicode-lf.txt',
		// Ends two bytes into a four-byte character. Truncating to a character boundary,
		// or round-tripping through a UTF-8 string, would change the bytes returned.
		range: Object.freeze({ startByte: 0, endByte: EMOJI_BYTE_START + 2 }),
		expected: windowOf('src/unicode-lf.txt', 0, EMOJI_BYTE_START + 2),
		rationale: 'A window ending mid-character must return the partial bytes exactly, not repair them.',
	}),
	Object.freeze({
		id: 'stale-branch-ref',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'stale',
		path: 'src/alpha.ts',
		range: null,
		expected: Object.freeze({ kind: 'unavailable' as const, reason: 'stale_ref' as const }),
		rationale: 'A superseded revision must report unavailable, never silently resolve to current HEAD.',
	}),
	Object.freeze({
		id: 'missing-blob',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: 'src/does-not-exist.ts',
		range: null,
		expected: Object.freeze({ kind: 'unavailable' as const, reason: 'missing_blob' as const }),
		rationale: 'An absent object is unavailable - distinct from denied and distinct from empty.',
	}),
	Object.freeze({
		id: 'symlink-escape',
		qcase: 'Q04',
		repo: 'alpha',
		revision: 'head',
		path: ESCAPE_LINK_PATH,
		range: null,
		expected: Object.freeze({ kind: 'rejected' as const, reason: 'path_escape' as const }),
		rationale: 'A symlink resolving outside the snapshot root is rejected before any read.',
	}),
])

/** Path inputs rejected before touching the filesystem; these never reach a snapshot. */
export const PATH_INJECTION_INPUTS: readonly {
	readonly id: string
	readonly path: string
	readonly rationale: string
}[] = Object.freeze([
	Object.freeze({ id: 'dotdot-relative', path: '../etc/passwd', rationale: 'Classic parent traversal.' }),
	Object.freeze({ id: 'dotdot-nested', path: 'src/../../etc/passwd', rationale: 'Traversal after a valid prefix.' }),
	Object.freeze({ id: 'absolute-posix', path: '/etc/passwd', rationale: 'Absolute path ignores the snapshot root.' }),
	Object.freeze({ id: 'absolute-windows', path: 'C:\\Windows\\win.ini', rationale: 'Drive-qualified absolute path.' }),
	Object.freeze({
		id: 'backslash-traversal',
		path: '..\\..\\windows\\win.ini',
		rationale: 'Backslash separators on a POSIX host.',
	}),
	Object.freeze({
		id: 'null-byte',
		path: 'src/alpha.ts\u0000.png',
		rationale: 'NUL truncation against a C-level path API.',
	}),
	Object.freeze({
		id: 'url-encoded-dotdot',
		path: 'src/%2e%2e/%2e%2e/etc/passwd',
		rationale: 'Encoded traversal must not be decoded and then trusted.',
	}),
	Object.freeze({ id: 'git-internal', path: '.git/config', rationale: 'Repository internals are not selected source.' }),
])

export type RepoManifest = {
	readonly generator: string
	readonly note: string
	readonly repos: Record<
		RepoName,
		{
			readonly bundle: string
			readonly headCommit: string
			readonly staleCommit: string | null
			readonly branch: string
			readonly files: Record<string, { readonly blob: string; readonly sha256: string; readonly byteLength: number }>
			readonly symlinks?: Record<string, string>
		}
	>
}

export function bundlePath(repo: RepoName): string {
	return join(REPOS_DIR, `${repo}.bundle`)
}

export function manifestPath(): string {
	return join(REPOS_DIR, 'manifest.json')
}

export function readManifest(): RepoManifest {
	return JSON.parse(readFileSync(manifestPath(), 'utf8')) as RepoManifest
}

/**
 * Restores a fixture bundle into `dest` as a real working tree. Bundles are real git
 * objects, so this exercises actual git restoration rather than a directory copy.
 */
export function restoreFixtureRepo(repo: RepoName, dest: string): string {
	const target = resolve(dest)
	execFileSync('git', ['clone', '--quiet', bundlePath(repo), target], { stdio: 'pipe' })
	return target
}

export function gitIn(cwd: string, args: readonly string[]): string {
	return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
}
