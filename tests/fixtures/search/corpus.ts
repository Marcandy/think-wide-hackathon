import { createHash } from "node:crypto";
import type { ScanEntry } from "../../../src/server/search/caps.ts";
import { UNICODE_CRLF, UNICODE_LF } from "../repos/cases.ts";

/**
 * T07 · Q05 — synthetic scan corpus.
 *
 * Operator-authored, clearly synthetic, no ingested third-party source. Each file
 * exists for a named case in tests/domain/q05-search.test.ts:
 *
 *   alpha.ts          positive literal + positive structural (exported declaration)
 *   near-miss.ts      MISLEADING SAME NAME: the identifiers appear in a comment, a
 *                     string and a call, so literal search hits and structural does not
 *   broken.ts         does not parse -> coverage.parseFailed, never "no match"
 *   notes.md          not a language the rule covers -> unsupportedLanguage
 *   link.txt          symlink entry -> excluded, target never resolved
 *   blob.bin          NUL bytes -> excluded
 *   repeat.ts         more occurrences than one page holds -> page_limit + cursor
 *
 * Byte offsets in the tests are computed from these strings, never hardcoded, so
 * editing a fixture cannot leave a test asserting a stale window that still passes.
 */

const COMMIT_ALPHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const COMMIT_BETA = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";

export const ALPHA_TS = [
	"// SYNTHETIC FIXTURE - T07/Q05. Mentions alphaMarker in this comment.",
	"export function alphaMarker(): string {",
	'\treturn "SYNTHETIC_ALPHA_MARKER_0001"',
	"}",
	"",
].join("\n");

/** Same identifiers, no exported declaration and no eval call. */
export const NEAR_MISS_TS = [
	"// SYNTHETIC FIXTURE - T07/Q05 near miss.",
	"// alphaMarker is described here but not declared here.",
	'const label = "alphaMarker"',
	"const evaluated = evaluate(label)",
	'const warning = "do not call eval(x) on untrusted text"',
	"function alphaMarker2() {}",
	"export { evaluated, warning }",
	"",
].join("\n");

export const EVAL_TS = [
	"// SYNTHETIC FIXTURE - T07/Q05 dynamic execution.",
	"export function run(source: string): unknown {",
	"\treturn eval(source)",
	"}",
	"",
].join("\n");

export const BROKEN_TS = [
	"// SYNTHETIC FIXTURE - T07/Q05 deliberately unparsable.",
	"export function broken(: {",
	"",
].join("\n");

export const NOTES_MD = [
	"# SYNTHETIC FIXTURE - T07/Q05",
	"",
	"alphaMarker is mentioned in prose. Prose is not TypeScript.",
	"",
].join("\n");

export const BETA_TS = [
	"// SYNTHETIC FIXTURE - second repo. T07/Q05.",
	"export function betaMarker(): string {",
	'\treturn "SYNTHETIC_BETA_MARKER_0001"',
	"}",
	"",
].join("\n");

/** 25 occurrences: more than SEARCH_CAPS.hitsPerPage, so paging is exercised. */
export const REPEAT_TS = `${Array.from(
	{ length: 25 },
	(_, i) => `const REPEAT_TOKEN_${i} = "REPEAT_TOKEN"`,
).join("\n")}\n`;

function blobId(content: Uint8Array): string {
	// Synthetic, stable, and shaped like a git object id. T05 replaces these with the
	// real blob ids from the snapshot; nothing here should be read as a git object.
	return createHash("sha1").update(content).digest("hex");
}

function entry(
	repo: "alpha" | "beta",
	path: string,
	content: string | Uint8Array,
	kind: ScanEntry["kind"] = "blob",
): ScanEntry {
	const bytes =
		typeof content === "string" ? Buffer.from(content, "utf8") : content;
	return Object.freeze({
		repositoryId: `repo.${repo}`,
		snapshotId: `snap.${repo}.1`,
		commit: repo === "alpha" ? COMMIT_ALPHA : COMMIT_BETA,
		entryId: `entry.${repo}.${path.replace(/[^A-Za-z0-9.-]/g, "_")}`,
		blobId: blobId(bytes),
		path,
		kind,
		bytes,
	});
}

export const CORPUS: readonly ScanEntry[] = Object.freeze([
	entry("alpha", "src/alpha.ts", ALPHA_TS),
	entry("alpha", "src/near-miss.ts", NEAR_MISS_TS),
	entry("alpha", "src/eval.ts", EVAL_TS),
	entry("alpha", "src/broken.ts", BROKEN_TS),
	entry("alpha", "docs/notes.md", NOTES_MD),
	entry("alpha", "src/link.txt", "../../../../etc/passwd", "symlink"),
	entry("alpha", "assets/blob.bin", Buffer.from([0x00, 0x01, 0x00, 0x02])),
	entry("beta", "lib/beta.ts", BETA_TS),
]);

/**
 * The T04 Q04 unicode fixtures, reused rather than re-declared: the same logical text
 * in LF and CRLF, with a combining sequence, a non-BMP emoji and CJK. A search that
 * slices by JS string index instead of byte offset makes these two disagree.
 */
export const UNICODE_CORPUS: readonly ScanEntry[] = Object.freeze([
	entry("alpha", "src/unicode-lf.txt", UNICODE_LF),
	entry("alpha", "src/unicode-crlf.txt", UNICODE_CRLF),
]);

export const REPEAT_CORPUS: readonly ScanEntry[] = Object.freeze([
	entry("alpha", "src/repeat.ts", REPEAT_TS),
]);

export function corpusEntry(path: string): ScanEntry {
	const found = CORPUS.find((e) => e.path === path);
	if (!found) throw new Error(`unknown corpus entry: ${path}`);
	return found;
}
