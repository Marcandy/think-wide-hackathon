import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as v from "../../generated/validators.js";
import { SEARCH_CAPS } from "../../src/server/search/caps.ts";
import { literalSearch } from "../../src/server/search/literal.ts";
import {
	getRule,
	loadRules,
	probeAnalyzer,
	structuralSearch,
} from "../../src/server/search/structural.ts";
import {
	ALPHA_TS,
	CORPUS,
	corpusEntry,
	NEAR_MISS_TS,
	REPEAT_CORPUS,
	UNICODE_CORPUS,
} from "../fixtures/search/corpus.ts";

/**
 * T07 · Q05 — literal and structural fixtures, misleading same-name syntax, parse
 * failure, scan caps.
 *
 * Layer: unit. These exercise the real search modules and the real ast-grep binary
 * against synthetic fixtures. They do NOT exercise a handler, authorization, or a T05
 * snapshot, so Q05 application acceptance stays NOT RUN in the registry until a
 * handler binds these to authorized snapshots.
 */

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("Q05 literal search", () => {
	it("finds the declaration and the comment mention, and nothing in the near miss file", () => {
		const result = literalSearch(CORPUS, { text: "alphaMarker" });
		const paths = result.entries.map((f) => f.refs[0].displayPath);
		expect(paths).toContain("src/alpha.ts");
		// Literal search is honest about what it is: the near-miss file DOES contain the
		// string, so it must appear here. Telling it apart is the structural test below.
		expect(paths).toContain("src/near-miss.ts");
		expect(paths).not.toContain("lib/beta.ts");
	});

	it("gives every hit an exact ref whose digest reproduces from the bytes", () => {
		const result = literalSearch(CORPUS, { text: "alphaMarker" });
		expect(result.entries.length).toBeGreaterThan(0);
		for (const finding of result.entries) {
			const ref = finding.refs[0];
			const entry = CORPUS.find((e) => e.entryId === ref.entryId);
			if (!entry) throw new Error(`ref points at no entry: ${ref.entryId}`);
			const window = entry.bytes.subarray(
				ref.byteRange.start,
				ref.byteRange.end,
			);
			expect(Buffer.from(window).toString("utf8")).toBe("alphaMarker");
			expect(ref.digest).toBe(sha256(window));
			expect(finding.evidenceClass).toBe("observed_literal");
			expect(finding.extractor?.kind).toBe("literal-search");
		}
	});

	it("uses byte offsets, not string indices", () => {
		const expected = Buffer.from(ALPHA_TS, "utf8").indexOf(
			Buffer.from("export function alphaMarker", "utf8"),
		);
		const result = literalSearch([corpusEntry("src/alpha.ts")], {
			text: "export function alphaMarker",
		});
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].refs[0].byteRange.start).toBe(expected);
	});

	it("returns no match for a string that is absent, with complete coverage", () => {
		const result = literalSearch([corpusEntry("src/alpha.ts")], {
			text: "SYNTHETIC_BETA_MARKER_0001",
		});
		expect(result.entries).toHaveLength(0);
		expect(result.coverage.status).toBe("complete");
		expect(result.truncated.is).toBe(false);
	});

	it("excludes symlinks and binary blobs instead of reading through them", () => {
		const result = literalSearch(CORPUS, { text: "passwd" });
		expect(result.entries).toHaveLength(0);
		expect(result.coverage.excluded).toBeGreaterThanOrEqual(2);
		expect(result.coverage.status).toBe("partial");
	});

	it("caps a page and returns a cursor bound to the query", () => {
		const first = literalSearch(REPEAT_CORPUS, { text: "REPEAT_TOKEN" });
		expect(first.entries).toHaveLength(SEARCH_CAPS.hitsPerPage);
		expect(first.truncated).toEqual({ is: true, reason: "page_limit" });
		expect(first.nextCursor).toBeTruthy();
		// Never infer a total from a capped page: coverage says partial, not "25 hits".
		expect(first.coverage.status).toBe("partial");

		const second = literalSearch(
			REPEAT_CORPUS,
			{ text: "REPEAT_TOKEN" },
			{ cursor: first.nextCursor },
		);
		expect(second.entries.length).toBeGreaterThan(0);
		const firstStarts = first.entries.map((f) => f.refs[0].byteRange.start);
		const secondStarts = second.entries.map((f) => f.refs[0].byteRange.start);
		expect(secondStarts.every((s) => !firstStarts.includes(s))).toBe(true);
	});

	it("rejects a cursor replayed against a changed query", () => {
		const first = literalSearch(REPEAT_CORPUS, { text: "REPEAT_TOKEN" });
		expect(() =>
			literalSearch(
				REPEAT_CORPUS,
				{ text: "REPEAT_TOKEN_1" },
				{ cursor: first.nextCursor },
			),
		).toThrowError(/does not belong to this query/);
	});

	it("reports the time cap instead of silently returning a short page", () => {
		let clock = 1_000;
		const result = literalSearch(
			CORPUS,
			{ text: "alphaMarker" },
			{
				now: () => {
					clock += SEARCH_CAPS.wallClockMs;
					return clock;
				},
			},
		);
		expect(result.coverage.timeLimited).toBe(true);
		expect(result.coverage.status).toBe("partial");
	});

	it("refuses an empty query, an oversize query and non-ASCII case folding", () => {
		expect(() => literalSearch(CORPUS, { text: "" })).toThrowError(/empty/);
		expect(() =>
			literalSearch(CORPUS, {
				text: "x".repeat(SEARCH_CAPS.maxQueryBytes + 1),
			}),
		).toThrowError(/exceeds/);
		expect(() =>
			literalSearch(CORPUS, { text: "café", caseSensitive: false }),
		).toThrowError(/ASCII-only/);
	});

	it("returns identical byte windows for the LF and CRLF unicode fixtures", () => {
		// Same logical text, two newline encodings, non-ASCII throughout. The matched
		// window must be the query's bytes in both, and the digests must agree.
		const lf = literalSearch([UNICODE_CORPUS[0]], { text: "漢字" });
		const crlf = literalSearch([UNICODE_CORPUS[1]], { text: "漢字" });
		expect(lf.entries).toHaveLength(1);
		expect(crlf.entries).toHaveLength(1);
		const want = sha256(Buffer.from("漢字", "utf8"));
		expect(lf.entries[0].refs[0].digest).toBe(want);
		expect(crlf.entries[0].refs[0].digest).toBe(want);
		// The byte offsets differ because CRLF adds a byte per preceding line: proof the
		// offsets are byte offsets in each blob, not shared character indices.
		expect(crlf.entries[0].refs[0].byteRange.start).toBeGreaterThan(
			lf.entries[0].refs[0].byteRange.start,
		);
	});

	it("addresses a four-byte emoji by its exact byte range", () => {
		const entry = UNICODE_CORPUS[0];
		const expected = Buffer.from(entry.bytes).indexOf(
			Buffer.from("🧪", "utf8"),
		);
		const result = literalSearch([entry], { text: "🧪" });
		expect(result.entries).toHaveLength(1);
		const ref = result.entries[0].refs[0];
		expect(ref.byteRange).toEqual({ start: expected, end: expected + 4 });
		expect(ref.digest).toBe(sha256(Buffer.from("🧪", "utf8")));
	});

	it("produces an envelope the published contract accepts", () => {
		const result = literalSearch(CORPUS, { text: "alphaMarker" });
		expect(v.ResultEnvelope(result)).toBe(true);
		for (const finding of result.entries) expect(v.Finding(finding)).toBe(true);
	});
});

describe("Q05 structural search", () => {
	const probe = probeAnalyzer();

	it("loads reviewed rules and refuses any rule that would rewrite source", () => {
		const rules = loadRules();
		expect(rules.map((r) => r.ruleId).sort()).toEqual([
			"dynamic-code-execution",
			"exported-function-declaration",
		]);
		for (const rule of rules) {
			expect(rule.yaml).not.toMatch(/^\s*fix:/m);
			expect(rule.ruleHash).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it.runIf(probe.available)(
		"separates a declaration from a same-name mention that literal search cannot",
		() => {
			const result = structuralSearch(CORPUS, "exported-function-declaration");
			const paths = result.entries.map((f) => f.refs[0].displayPath).sort();
			expect(paths).toContain("src/alpha.ts");
			expect(paths).toContain("lib/beta.ts");
			// The near-miss file mentions alphaMarker in a comment, a string and a call,
			// and declares a non-exported function. None of those is an exported
			// declaration, so structural must not report it.
			expect(paths).not.toContain("src/near-miss.ts");
			expect(Buffer.from(NEAR_MISS_TS, "utf8").includes("alphaMarker")).toBe(
				true,
			);
		},
	);

	it.runIf(probe.available)(
		"matches a real eval call and not the word eval in prose, a name or a string",
		() => {
			const result = structuralSearch(CORPUS, "dynamic-code-execution");
			const paths = result.entries.map((f) => f.refs[0].displayPath);
			expect(paths).toEqual(["src/eval.ts"]);
		},
	);

	it.runIf(probe.available)(
		"records the analyzer version and rule hash on every finding",
		() => {
			const rule = getRule("exported-function-declaration");
			const result = structuralSearch(CORPUS, "exported-function-declaration");
			expect(result.entries.length).toBeGreaterThan(0);
			for (const finding of result.entries) {
				expect(finding.evidenceClass).toBe("observed_structural");
				expect(finding.extractor).toMatchObject({
					kind: "ast-grep",
					version: probe.version,
					ruleHash: rule.ruleHash,
				});
			}
		},
	);

	it.runIf(probe.available)(
		"gives structural hits refs whose digests reproduce from the original bytes",
		() => {
			const result = structuralSearch(CORPUS, "exported-function-declaration");
			for (const finding of result.entries) {
				const ref = finding.refs[0];
				const entry = CORPUS.find((e) => e.entryId === ref.entryId);
				if (!entry) throw new Error(`ref points at no entry: ${ref.entryId}`);
				const window = entry.bytes.subarray(
					ref.byteRange.start,
					ref.byteRange.end,
				);
				expect(ref.digest).toBe(sha256(window));
				expect(Buffer.from(window).toString("utf8")).toContain("function");
			}
			const { analyzer: _analyzer, ...envelope } = result;
			expect(v.ResultEnvelope(envelope)).toBe(true);
		},
	);

	it.runIf(probe.available)(
		"reports parse failure and unsupported language instead of calling them clean",
		() => {
			const result = structuralSearch(CORPUS, "exported-function-declaration");
			expect(result.coverage.parseFailed).toBe(1); // src/broken.ts
			expect(result.coverage.unsupportedLanguage).toBeGreaterThanOrEqual(1); // notes.md
			expect(result.coverage.excluded).toBeGreaterThanOrEqual(2); // symlink, binary
			expect(result.coverage.status).toBe("partial");
		},
	);

	it("reports structural as not indexed when the analyzer is unavailable", () => {
		if (probe.available) {
			expect(probe.version).toMatch(/^[0-9]/);
			return;
		}
		const result = structuralSearch(CORPUS, "exported-function-declaration");
		expect(result.entries).toHaveLength(0);
		expect(result.coverage.status).toBe("not_indexed");
		expect(result.analyzer.available).toBe(false);
	});
});
