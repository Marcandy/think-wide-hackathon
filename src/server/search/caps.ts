/**
 * T07 · search caps and the shape the search handlers operate on.
 *
 * Caps are the initial policy from issue #7 and 05_SECURITY_AND_CI.md. They live here,
 * not in `core/limits.ts`, because T06 owns that file and it has not landed. When it
 * does, this module should re-export from core rather than keep a second copy.
 *
 * A cap that is only documented is not a cap. Every value below is read by literal.ts
 * or structural.ts and asserted in tests/domain/q05-search.test.ts.
 */

export const SEARCH_CAPS = {
	/** Snapshots per request. The contract also caps snapshotIds at 2. */
	maxSnapshots: 2,
	/** Files opened per request, across all snapshots. */
	maxFiles: 200,
	/** Bytes actually scanned per request. */
	maxScanBytes: 20 * 1024 * 1024,
	/** Wall clock for one search, including the analyzer subprocess. */
	wallClockMs: 5_000,
	/** Hits per page. Never infer a total from a capped page. */
	hitsPerPage: 20,
	/** Bytes of source text any single result may carry. */
	maxResultTextBytes: 16 * 1024,
	/** Contract bound on the literal query itself. */
	maxQueryBytes: 256,
} as const;

/**
 * One immutable snapshot entry handed to a search. T05 will produce these from real
 * snapshots; until then the fixtures in tests/fixtures/search build them directly.
 *
 * `bytes` are the exact blob bytes. Nothing in search resolves a path on disk, follows
 * a symlink, or reads the host filesystem to obtain content: the caller supplies bytes
 * that were already authorized.
 */
export type ScanEntry = {
	readonly repositoryId: string;
	readonly snapshotId: string;
	/** Full commit id. A branch name is not a snapshot. */
	readonly commit: string;
	readonly entryId: string;
	readonly blobId: string;
	/** Presentation only. Never used for lookup or authorization. */
	readonly path: string;
	readonly kind: "blob" | "symlink" | "submodule";
	readonly bytes: Uint8Array;
};

/** Why a file did not contribute results. The buckets stay separate on purpose. */
export type Coverage = {
	status: "complete" | "partial" | "not_indexed";
	filesScanned: number;
	bytesScanned: number;
	notIndexed: number;
	unsupportedLanguage: number;
	parseFailed: number;
	byteLimited: boolean;
	timeLimited: boolean;
	excluded: number;
};

export function emptyCoverage(): Coverage {
	return {
		status: "complete",
		filesScanned: 0,
		bytesScanned: 0,
		notIndexed: 0,
		unsupportedLanguage: 0,
		parseFailed: 0,
		byteLimited: false,
		timeLimited: false,
		excluded: 0,
	};
}

/**
 * Coverage is partial the moment anything was not looked at. A caller must not read
 * "complete" as "the repository contains nothing else", and must not read an empty
 * result page as "the pattern does not occur".
 */
export function finalizeCoverage(
	c: Coverage,
	pageTruncated: boolean,
): Coverage {
	const missed =
		c.notIndexed + c.unsupportedLanguage + c.parseFailed + c.excluded > 0;
	if (c.filesScanned === 0 && missed) c.status = "not_indexed";
	else if (missed || c.byteLimited || c.timeLimited || pageTruncated)
		c.status = "partial";
	else c.status = "complete";
	return c;
}

export class SearchInputError extends Error {
	readonly code = "invalid_request";
}

/** A cursor that does not belong to this exact query is a conflict, not a reset. */
export class CursorConflictError extends Error {
	readonly code = "conflict";
}
