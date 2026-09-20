import { createHash } from "node:crypto";
import type {
	Finding,
	ResultEnvelope,
	SourceRef,
} from "../../../generated/types.ts";
import {
	type Coverage,
	CursorConflictError,
	emptyCoverage,
	finalizeCoverage,
	objectHashAlgorithm,
	type ScanEntry,
	SEARCH_CAPS,
	SearchInputError,
} from "./caps.ts";

/**
 * T07 · Q05 — fixed-string search over immutable snapshot bytes.
 *
 * FIXED STRING, NOT REGEX, AND NOT CONVEX TEXT SEARCH. The query is matched with
 * Buffer.indexOf over blob bytes, so `a.b(` matches only `a.b(`, offsets are byte
 * offsets rather than JS string indices, and no user input reaches a regex engine.
 *
 * Every hit carries an exact SourceRef whose digest is the sha256 of exactly the
 * matched byte window, recomputed from the entry bytes. A ref whose digest does not
 * reproduce is not evidence.
 */

export type LiteralQuery = {
	readonly text: string;
	readonly caseSensitive?: boolean;
};

export type SearchOptions = {
	/** Injected in tests so the time cap is deterministic. */
	readonly now?: () => number;
	readonly cursor?: string | null;
	readonly pathPrefix?: string;
};

export type SearchEnvelope = Omit<ResultEnvelope, "entries" | "kind"> & {
	kind: "search";
	entries: Finding[];
};

/**
 * The contract caps a scope at 8 snapshots and codegen expresses that as a tuple union,
 * so the array has to be narrowed rather than widened. SEARCH_CAPS.maxSnapshots (2) is
 * enforced before this point; the slice here is a second check, not the enforcement.
 */
export function searchScope(
	snapshotIds: readonly string[],
): SearchEnvelope["scope"] {
	return {
		snapshotIds: snapshotIds.slice(
			0,
			8,
		) as SearchEnvelope["scope"]["snapshotIds"],
	};
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Binary detection: a NUL in the first 8 KiB. Binary blobs are excluded, not scanned. */
function looksBinary(bytes: Uint8Array): boolean {
	return bytes.subarray(0, 8192).includes(0);
}

/** 1-based inclusive line range for presentation. Computed from bytes, not characters. */
export function lineRange(
	bytes: Uint8Array,
	start: number,
	end: number,
): { start: number; end: number } {
	let line = 1;
	let startLine = 1;
	for (let i = 0; i < end && i < bytes.length; i++) {
		if (i === start) {
			startLine = line;
		}
		if (bytes[i] === 0x0a) {
			line++;
		}
	}
	if (start >= end) {
		startLine = line;
	}
	return { start: startLine, end: line };
}

/**
 * ASCII-only case folding. Case-insensitive matching of non-ASCII text needs real
 * Unicode case folding, which byte-level fixed-string search does not do; claiming it
 * silently would produce false negatives that look exactly like "no results".
 */
function foldAscii(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] as number;
		out[i] = b >= 0x41 && b <= 0x5a ? b + 32 : b;
	}
	return out;
}

/**
 * Binds a cursor to the EFFECTIVE scope it was issued for, not just the query text.
 *
 * Review of 200487c found the first version binding only query plus snapshot ids: a
 * cursor issued for one `pathPrefix` was happily resumed under another, and a page
 * position from one entry ordering meant something else after the ordering changed.
 * Both produce a page that looks authoritative and is not. Everything that changes
 * what "position 7" means therefore goes into the binding, including the ordered entry
 * ids themselves.
 *
 * This is result integrity, not authorization. A cursor is an address; the operation
 * boundary still re-authorizes the principal and every referenced object on each page.
 */
function queryBinding(
	query: LiteralQuery,
	snapshotIds: readonly string[],
	entries: readonly ScanEntry[],
	pathPrefix: string | undefined,
): string {
	return sha256Hex(
		Buffer.from(
			JSON.stringify({
				mode: "literal",
				text: query.text,
				caseSensitive: query.caseSensitive !== false,
				pathPrefix: pathPrefix ?? null,
				snapshotIds: [...snapshotIds].sort(),
				// Ordering, not just membership: paging walks entries by index.
				entryOrder: sha256Hex(
					Buffer.from(entries.map((e) => e.entryId).join("|"), "utf8"),
				),
			}),
			"utf8",
		),
	);
}

type CursorState = { b: string; e: number; o: number };

function encodeCursor(state: CursorState): string {
	return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeCursor(
	cursor: string,
	binding: string,
	entries: readonly ScanEntry[],
): CursorState {
	let parsed: CursorState;
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw new CursorConflictError("cursor is not readable");
	}
	if (
		typeof parsed?.b !== "string" ||
		!Number.isInteger(parsed?.e) ||
		!Number.isInteger(parsed?.o)
	) {
		throw new CursorConflictError("cursor is malformed");
	}
	// A changed query, filter, snapshot set or entry ordering invalidates the position.
	if (parsed.b !== binding) {
		throw new CursorConflictError(
			"cursor does not belong to this query or scope",
		);
	}
	// A position outside the scope is a conflict. Accepting it returns zero hits with
	// complete coverage, which reads as "nothing here" and is a lie.
	if (parsed.e < 0 || parsed.e >= entries.length) {
		throw new CursorConflictError("cursor entry position is out of range");
	}
	const entry = entries[parsed.e] as ScanEntry;
	if (parsed.o < 0 || parsed.o > entry.bytes.byteLength) {
		throw new CursorConflictError("cursor byte position is out of range");
	}
	return parsed;
}

export function literalSearch(
	entries: readonly ScanEntry[],
	query: LiteralQuery,
	options: SearchOptions = {},
): SearchEnvelope {
	const now = options.now ?? Date.now;
	const started = now();
	const deadline = started + SEARCH_CAPS.wallClockMs;

	const needleRaw = Buffer.from(query.text, "utf8");
	if (needleRaw.byteLength === 0) {
		throw new SearchInputError("literal query must not be empty");
	}
	if (needleRaw.byteLength > SEARCH_CAPS.maxQueryBytes) {
		throw new SearchInputError(
			`literal query exceeds ${SEARCH_CAPS.maxQueryBytes} bytes`,
		);
	}
	const caseSensitive = query.caseSensitive !== false;
	if (!caseSensitive && needleRaw.some((b) => b > 0x7f)) {
		throw new SearchInputError(
			"case-insensitive literal search is ASCII-only; use caseSensitive for non-ASCII queries",
		);
	}

	const snapshotIds = [...new Set(entries.map((e) => e.snapshotId))];
	if (snapshotIds.length > SEARCH_CAPS.maxSnapshots) {
		throw new SearchInputError(
			`at most ${SEARCH_CAPS.maxSnapshots} snapshots per search`,
		);
	}

	const binding = queryBinding(query, snapshotIds, entries, options.pathPrefix);
	const resume = options.cursor
		? decodeCursor(options.cursor, binding, entries)
		: null;

	const needle = caseSensitive ? needleRaw : Buffer.from(foldAscii(needleRaw));
	const coverage: Coverage = emptyCoverage();
	const findings: Finding[] = [];
	let truncatedReason: "page_limit" | "byte_limit" | "time_limit" | null = null;
	let nextCursor: string | null = null;

	// Stable, deterministic order: the caller's order is preserved, so a cursor means
	// the same position on the next page.
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index] as ScanEntry;
		if (resume && index < resume.e) {
			continue;
		}
		if (options.pathPrefix && !entry.path.startsWith(options.pathPrefix)) {
			coverage.excluded++;
			continue;
		}
		// A symlink or submodule is an address to somewhere else. Search never resolves
		// one: that is how a committed link to /etc/passwd stays inert here.
		if (entry.kind !== "blob") {
			coverage.excluded++;
			continue;
		}
		if (looksBinary(entry.bytes)) {
			coverage.excluded++;
			continue;
		}
		if (coverage.filesScanned >= SEARCH_CAPS.maxFiles) {
			coverage.notIndexed++;
			coverage.byteLimited = true;
			truncatedReason ??= "byte_limit";
			continue;
		}
		if (
			coverage.bytesScanned + entry.bytes.byteLength >
			SEARCH_CAPS.maxScanBytes
		) {
			coverage.notIndexed++;
			coverage.byteLimited = true;
			truncatedReason ??= "byte_limit";
			continue;
		}
		if (now() > deadline) {
			coverage.notIndexed++;
			coverage.timeLimited = true;
			truncatedReason ??= "time_limit";
			continue;
		}

		coverage.filesScanned++;
		coverage.bytesScanned += entry.bytes.byteLength;

		const haystack = caseSensitive
			? Buffer.from(
					entry.bytes.buffer,
					entry.bytes.byteOffset,
					entry.bytes.byteLength,
				)
			: Buffer.from(foldAscii(entry.bytes));

		let from = resume && index === resume.e ? resume.o : 0;
		for (;;) {
			const at = haystack.indexOf(needle, from);
			if (at < 0) {
				break;
			}
			if (findings.length >= SEARCH_CAPS.hitsPerPage) {
				truncatedReason = "page_limit";
				nextCursor = encodeCursor({ b: binding, e: index, o: at });
				break;
			}
			findings.push(literalFinding(entry, at, at + needle.byteLength, started));
			from = at + needle.byteLength; // non-overlapping
		}
		if (nextCursor) {
			break;
		}
	}

	const pageTruncated = truncatedReason !== null;
	return {
		kind: "search",
		scope: searchScope(snapshotIds),
		entries: findings,
		coverage: finalizeCoverage(coverage, pageTruncated),
		nextCursor,
		truncated: pageTruncated
			? { is: true, reason: truncatedReason as "page_limit" }
			: { is: false },
	};
}

/** Builds the exact reference for one matched byte window. */
export function literalFinding(
	entry: ScanEntry,
	start: number,
	end: number,
	observedAt: number,
): Finding {
	const window = entry.bytes.subarray(start, end);
	const ref: SourceRef = {
		repositoryId: entry.repositoryId,
		snapshotId: entry.snapshotId,
		commit: entry.commit,
		hashAlgorithm: objectHashAlgorithm(entry),
		blobId: entry.blobId,
		entryId: entry.entryId,
		displayPath: entry.path,
		byteRange: { start, end },
		lineRange: lineRange(entry.bytes, start, end),
		digest: sha256Hex(window),
	};
	return {
		findingId: `f.lit.${entry.entryId}.${start}`,
		evidenceClass: "observed_literal",
		summary: `literal match in ${entry.path} at bytes ${start}-${end}`,
		refs: [ref],
		extractor: { kind: "literal-search", version: "t07.1" },
		verification: "bytes_verified",
		observedAt,
	};
}
