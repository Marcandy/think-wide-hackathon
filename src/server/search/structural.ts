import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding, SourceRef } from "../../../generated/types.ts";
import {
	type Coverage,
	emptyCoverage,
	finalizeCoverage,
	type ScanEntry,
	SEARCH_CAPS,
	SearchInputError,
} from "./caps.ts";
import {
	lineRange,
	type SearchEnvelope,
	searchScope,
	sha256Hex,
} from "./literal.ts";

/**
 * T07 · Q05 / Q13 — bounded ast-grep runner.
 *
 * The analyzer is a subprocess that reads ONLY the bytes we hand it, in a directory we
 * create, with an environment we build from nothing. The confinement rules, each one
 * asserted in tests/boundary/q13-analyzer-confinement.test.ts:
 *
 *   - execFile, never a shell: no interpolation of rule text, paths or queries.
 *   - A reviewed rule from src/server/search/rules/, addressed by id. Caller-supplied
 *     rule YAML is not accepted; a request carries a ruleId, per the contract.
 *   - No rewrite/update/interactive flags, ever. Asserted on the argv we build, so a
 *     later edit that adds one fails the test rather than rewriting someone's source.
 *   - No config discovery in the scanned tree: the rule is passed inline and the scan
 *     directory is ours, so an `sgconfig.yml` committed by a scanned repository is
 *     never loaded.
 *   - Clean env (PATH/HOME/LANG only): no application, provider or SSH credentials
 *     reach the analyzer, so a malicious rule or a tree-sitter bug cannot exfiltrate
 *     what it cannot read.
 *   - Wall-clock kill and an output cap, with the temp directory removed afterwards.
 *
 * Structural evidence is a structural match, not proven semantics. `evidenceClass` is
 * `observed_structural`; nothing here claims two systems are interchangeable.
 */

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "rules");

/** Flags that must never appear in our argv. Rewriting source is out of product scope. */
const FORBIDDEN_ARGS = [
	"-U",
	"--update-all",
	"--rewrite",
	"-i",
	"--interactive",
	"--config",
	"-r",
];

export type Rule = {
	readonly ruleId: string;
	readonly language: string;
	readonly yaml: string;
	/** sha256 of the exact rule text that produced a finding. */
	readonly ruleHash: string;
};

export type AnalyzerProbe = {
	readonly available: boolean;
	readonly version: string | null;
	readonly reason?: string;
};

/** Extensions we hand to the analyzer. Anything else is unsupportedLanguage, not clean. */
const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
	".ts": "TypeScript",
	".tsx": "Tsx",
	".js": "JavaScript",
	".jsx": "Tsx",
	".mjs": "JavaScript",
	".cjs": "JavaScript",
};

/** The environment the analyzer gets. Built from nothing, not filtered from ours. */
function cleanEnv(home: string): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: home,
		LANG: "C",
	};
}

export function assertNoMutatingArgs(args: readonly string[]): void {
	for (const arg of args) {
		if (FORBIDDEN_ARGS.includes(arg))
			throw new Error(`refusing to run the analyzer with ${arg}`);
		if (arg.startsWith("--rewrite") || arg.startsWith("--update"))
			throw new Error(`refusing to run the analyzer with ${arg}`);
	}
}

export function loadRules(): readonly Rule[] {
	const files = readdirSync(RULES_DIR)
		.filter((f) => f.endsWith(".yml"))
		.sort();
	return files.map((file) => {
		const yaml = readFileSync(join(RULES_DIR, file), "utf8");
		const id = /^id:\s*(\S+)/m.exec(yaml)?.[1];
		const language = /^language:\s*(\S+)/m.exec(yaml)?.[1];
		if (!id || !language)
			throw new Error(`rule ${file} must declare id and language`);
		if (/^\s*fix:/m.test(yaml))
			throw new Error(
				`rule ${file} declares a fix; this product never rewrites source`,
			);
		return Object.freeze({
			ruleId: id,
			language,
			yaml,
			ruleHash: sha256Hex(Buffer.from(yaml, "utf8")),
		});
	});
}

export function getRule(ruleId: string): Rule {
	const rule = loadRules().find((r) => r.ruleId === ruleId);
	if (!rule) throw new SearchInputError(`unknown ruleId: ${ruleId}`);
	return rule;
}

/** Runs the analyzer with confinement applied. Returns stdout, capped. */
export function runAnalyzer(
	args: readonly string[],
	cwd: string,
	timeoutMs: number,
): { stdout: string; timedOut: boolean; failed: boolean } {
	assertNoMutatingArgs(args);
	try {
		const stdout = execFileSync("ast-grep", [...args], {
			cwd,
			env: cleanEnv(cwd),
			timeout: timeoutMs,
			killSignal: "SIGKILL",
			maxBuffer: SEARCH_CAPS.maxResultTextBytes * 64,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
		});
		return { stdout, timedOut: false, failed: false };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & {
			signal?: string;
			stdout?: string;
		};
		const timedOut = err.signal === "SIGKILL" || err.code === "ETIMEDOUT";
		return { stdout: err.stdout ?? "", timedOut, failed: true };
	}
}

export function probeAnalyzer(): AnalyzerProbe {
	const home = mkdtempSync(join(tmpdir(), "twh-sg-probe-"));
	try {
		const out = runAnalyzer(["--version"], home, 2_000);
		const version = /ast-grep\s+([0-9][^\s]*)/.exec(out.stdout)?.[1] ?? null;
		if (!version)
			return {
				available: false,
				version: null,
				reason: "version not reported",
			};
		return { available: true, version };
	} catch (error) {
		return {
			available: false,
			version: null,
			reason: (error as Error).message,
		};
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

type SgMatch = {
	file: string;
	range: { byteOffset: { start: number; end: number } };
};

/**
 * Structural search over already-authorized bytes.
 *
 * When the analyzer is unavailable the envelope comes back with zero entries and
 * `status: "not_indexed"`: structural capability is reported missing rather than
 * quietly replaced by text matching.
 */
export function structuralSearch(
	entries: readonly ScanEntry[],
	ruleId: string,
	options: { now?: () => number } = {},
): SearchEnvelope & { analyzer: AnalyzerProbe } {
	const now = options.now ?? Date.now;
	const started = now();
	const rule = getRule(ruleId);
	const probe = probeAnalyzer();
	const coverage: Coverage = emptyCoverage();
	const snapshotIds = [...new Set(entries.map((e) => e.snapshotId))];

	if (!probe.available) {
		coverage.notIndexed = entries.length;
		return {
			kind: "search",
			scope: searchScope(snapshotIds),
			entries: [],
			coverage: finalizeCoverage(coverage, false),
			nextCursor: null,
			truncated: { is: false },
			analyzer: probe,
		};
	}

	const scanDir = mkdtempSync(join(tmpdir(), "twh-sg-scan-"));
	const findings: Finding[] = [];
	try {
		// Materialize only scannable blobs, under names we choose. The original path is
		// never used as a filesystem path, so `../` in a committed path cannot escape.
		const staged = new Map<string, ScanEntry>();
		mkdirSync(join(scanDir, "s"), { recursive: true });
		for (const entry of entries) {
			if (entry.kind !== "blob") {
				coverage.excluded++;
				continue;
			}
			// A blob with NUL bytes is not source the analyzer should parse, and it is
			// excluded rather than counted as an unsupported language: the same bucket
			// literal.ts uses, so the two modes report the same file the same way.
			if (entry.bytes.subarray(0, 8192).includes(0)) {
				coverage.excluded++;
				continue;
			}
			const ext = extname(entry.path).toLowerCase();
			if (LANGUAGE_BY_EXT[ext] !== rule.language) {
				coverage.unsupportedLanguage++;
				continue;
			}
			if (coverage.filesScanned >= SEARCH_CAPS.maxFiles) {
				coverage.notIndexed++;
				coverage.byteLimited = true;
				continue;
			}
			if (
				coverage.bytesScanned + entry.bytes.byteLength >
				SEARCH_CAPS.maxScanBytes
			) {
				coverage.notIndexed++;
				coverage.byteLimited = true;
				continue;
			}
			const name = `s/${sha256Hex(Buffer.from(entry.entryId, "utf8")).slice(0, 16)}${ext}`;
			writeFileSync(join(scanDir, name), entry.bytes);
			staged.set(name, entry);
			coverage.filesScanned++;
			coverage.bytesScanned += entry.bytes.byteLength;
		}

		if (staged.size > 0) {
			const files = [...staged.keys()];
			const elapsed = now() - started;
			const budget = Math.max(500, SEARCH_CAPS.wallClockMs - elapsed);

			// Files that do not parse are reported, not silently counted as "no match".
			const parseProbe = runAnalyzer(
				[
					"scan",
					"--inline-rules",
					`id: twh-parse-error\nlanguage: ${rule.language}\nrule:\n  kind: ERROR\n`,
					"--json=compact",
					...files,
				],
				scanDir,
				budget,
			);
			const unparsable = new Set(
				parseMatches(parseProbe.stdout).map((m) => m.file),
			);
			coverage.parseFailed = unparsable.size;
			if (parseProbe.timedOut) coverage.timeLimited = true;

			const scan = runAnalyzer(
				[
					"scan",
					"--inline-rules",
					rule.yaml,
					"--json=compact",
					...files.filter((f) => !unparsable.has(f)),
				],
				scanDir,
				budget,
			);
			if (scan.timedOut) coverage.timeLimited = true;

			for (const match of parseMatches(scan.stdout)) {
				if (findings.length >= SEARCH_CAPS.hitsPerPage) break;
				const entry = staged.get(match.file);
				if (!entry) continue;
				const { start, end } = match.range.byteOffset;
				if (end > entry.bytes.byteLength || start > end) continue;
				findings.push(
					structuralFinding(entry, start, end, rule, probe, started),
				);
			}
		}
	} finally {
		// The analyzer's working directory never outlives the request.
		rmSync(scanDir, { recursive: true, force: true });
	}

	const truncated = findings.length >= SEARCH_CAPS.hitsPerPage;
	return {
		kind: "search",
		scope: searchScope(snapshotIds),
		entries: findings,
		coverage: finalizeCoverage(coverage, truncated),
		nextCursor: null,
		truncated: truncated ? { is: true, reason: "page_limit" } : { is: false },
		analyzer: probe,
	};
}

function parseMatches(stdout: string): SgMatch[] {
	const text = stdout.trim();
	if (!text) return [];
	try {
		const parsed = JSON.parse(text);
		return Array.isArray(parsed) ? (parsed as SgMatch[]) : [];
	} catch {
		return [];
	}
}

export function structuralFinding(
	entry: ScanEntry,
	start: number,
	end: number,
	rule: Rule,
	probe: AnalyzerProbe,
	observedAt: number,
): Finding {
	const window = entry.bytes.subarray(start, end);
	const ref: SourceRef = {
		repositoryId: entry.repositoryId,
		snapshotId: entry.snapshotId,
		commit: entry.commit,
		hashAlgorithm: "sha256",
		blobId: entry.blobId,
		entryId: entry.entryId,
		displayPath: entry.path,
		byteRange: { start, end },
		lineRange: lineRange(entry.bytes, start, end),
		digest: createHash("sha256").update(window).digest("hex"),
	};
	return {
		findingId: `f.str.${rule.ruleId}.${entry.entryId}.${start}`,
		evidenceClass: "observed_structural",
		summary: `${rule.ruleId} matched in ${entry.path} at bytes ${start}-${end}`,
		refs: [ref],
		extractor: {
			kind: "ast-grep",
			version: probe.version ?? "unknown",
			ruleHash: rule.ruleHash,
		},
		verification: "bytes_verified",
		observedAt,
	};
}
