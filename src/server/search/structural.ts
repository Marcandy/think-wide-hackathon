import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	accessSync,
	constants,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";
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
 * WHAT CONFINEMENT MEANS HERE, and what it does not.
 *
 * Review of 200487c was correct: a fresh cwd and a clean environment are process
 * hygiene, not confinement. A subprocess started that way runs with this process's
 * full OS permissions and can read and write anything we can. So the analyzer now runs
 * inside an isolation profile:
 *
 *   prlimit (address space, CPU, open files, file size 0)
 *     └─ bwrap --unshare-all (no network, no IPC, own PID/user namespace)
 *          read-only system paths, tmpfs over /tmp, the selected bytes mounted
 *          read-only at /scan, --clearenv plus exactly PATH/HOME/LANG, --die-with-parent
 *
 * `--unshare-all` denies the network. `--fsize=0` denies creating file content. The
 * canary, the repository and every host path outside the binds simply are not present
 * in the analyzer's mount namespace, so a forbidden read fails with ENOENT rather than
 * relying on the analyzer choosing not to look.
 *
 * WHEN THE PROFILE IS UNAVAILABLE the analyzer does not run. `detectIsolation()`
 * reports `mode: "none"`, `structuralSearch` returns `status: "not_indexed"` and
 * structural capability is missing. Running unisolated requires an explicit
 * `THINKWIDE_ALLOW_UNISOLATED_ANALYZER=1`, which belongs to a local demonstration
 * configuration only and is reported in the probe so no result can quietly claim the
 * confined path was used.
 *
 * STILL NOT ESTABLISHED by this module: hosted/deployed isolation, seccomp syscall
 * filtering, and behavior at real repository scale.
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

/** Resource ceilings for the analyzer process. */
const ISOLATION_LIMITS = {
	/** Address space. A rule that explodes memory is killed, not tolerated. */
	memoryBytes: 2 * 1024 * 1024 * 1024,
	/** CPU seconds, a backstop under the wall-clock deadline. */
	cpuSeconds: 10,
	openFiles: 256,
} as const;

export type Isolation =
	| {
			readonly mode: "bwrap";
			readonly memoryBytes: number;
			readonly cpuSeconds: number;
	  }
	| { readonly mode: "none"; readonly reason: string };

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
	readonly isolation: Isolation;
	readonly reason?: string;
};

/** Why a run produced no usable output. "ok" is the only value that may be trusted. */
export type RunFailure =
	| "ok"
	| "isolation_unavailable"
	| "not_found"
	| "timed_out"
	| "output_capped"
	| "exit_status"
	| "invalid_output";

export type RunResult = {
	readonly stdout: string;
	readonly failure: RunFailure;
	readonly exitCode: number | null;
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

export function assertNoMutatingArgs(args: readonly string[]): void {
	for (const arg of args) {
		if (FORBIDDEN_ARGS.includes(arg))
			throw new Error(`refusing to run the analyzer with ${arg}`);
		if (arg.startsWith("--rewrite") || arg.startsWith("--update"))
			throw new Error(`refusing to run the analyzer with ${arg}`);
	}
}

/**
 * Resolves `ast-grep` on PATH. Resolution is deliberate rather than letting execFile do
 * it: the sandbox has to mount the real binary, and a test or a local demonstration
 * that substitutes a controlled executable on PATH must go through the same argv.
 */
function resolveBinary(name = "ast-grep"): string | null {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, name);
		try {
			accessSync(candidate, constants.X_OK);
			return realpathSync(candidate);
		} catch {
			// next PATH entry
		}
	}
	return null;
}

function allowUnisolated(): boolean {
	return process.env.THINKWIDE_ALLOW_UNISOLATED_ANALYZER === "1";
}

function roBindIfPresent(path: string): string[] {
	try {
		accessSync(path, constants.R_OK);
		return ["--ro-bind", path, path];
	} catch {
		return [];
	}
}

let isolationCache: Isolation | null = null;

/** Probes the isolation profile once per process. */
export function detectIsolation(force = false): Isolation {
	if (isolationCache && !force) return isolationCache;
	const bwrap = resolveBinary("bwrap");
	const prlimit = resolveBinary("prlimit");
	if (!bwrap || !prlimit) {
		isolationCache = {
			mode: "none",
			reason: bwrap ? "prlimit not found" : "bwrap not found",
		};
		return isolationCache;
	}
	try {
		execFileSync(
			bwrap,
			[
				"--unshare-all",
				"--die-with-parent",
				"--clearenv",
				"--ro-bind",
				"/usr",
				"/usr",
				...roBindIfPresent("/bin"),
				...roBindIfPresent("/lib"),
				...roBindIfPresent("/lib64"),
				"--tmpfs",
				"/tmp",
				"--",
				"/bin/true",
			],
			{ timeout: 5_000, stdio: "ignore", shell: false },
		);
		isolationCache = {
			mode: "bwrap",
			memoryBytes: ISOLATION_LIMITS.memoryBytes,
			cpuSeconds: ISOLATION_LIMITS.cpuSeconds,
		};
	} catch (error) {
		isolationCache = { mode: "none", reason: (error as Error).message };
	}
	return isolationCache;
}

/** Builds the confined argv. The scanned bytes are mounted read-only at /scan. */
function sandboxArgv(
	binary: string,
	args: readonly string[],
	scanDir: string,
): string[] {
	const prlimit = resolveBinary("prlimit") as string;
	const bwrap = resolveBinary("bwrap") as string;
	const bunRoot = join(homedir(), ".bun");
	return [
		prlimit,
		`--as=${ISOLATION_LIMITS.memoryBytes}`,
		`--cpu=${ISOLATION_LIMITS.cpuSeconds}`,
		`--nofile=${ISOLATION_LIMITS.openFiles}`,
		// No file content may be created: the analyzer reads, it never writes.
		"--fsize=0",
		"--",
		bwrap,
		"--unshare-all",
		"--die-with-parent",
		"--new-session",
		"--clearenv",
		"--setenv",
		"PATH",
		"/usr/bin:/bin",
		"--setenv",
		"HOME",
		"/sbx",
		"--setenv",
		"LANG",
		"C",
		"--ro-bind",
		"/usr",
		"/usr",
		...roBindIfPresent("/bin"),
		...roBindIfPresent("/lib"),
		...roBindIfPresent("/lib64"),
		...roBindIfPresent(bunRoot),
		// tmpfs first, then the binds that live under /tmp, or they are covered over.
		"--tmpfs",
		"/tmp",
		"--dir",
		"/sbx",
		...roBindIfPresent(dirname(binary)),
		"--ro-bind",
		scanDir,
		"/scan",
		"--proc",
		"/proc",
		"--dev",
		"/dev",
		"--chdir",
		"/scan",
		"--",
		binary,
		...args,
	];
}

/**
 * Runs the analyzer under the isolation profile with an explicit timeout.
 *
 * Never throws for an analyzer problem: it classifies. Callers must branch on
 * `failure`, because "no stdout" and "no matches" are different facts.
 */
export function runAnalyzer(
	args: readonly string[],
	scanDir: string,
	timeoutMs: number,
): RunResult {
	assertNoMutatingArgs(args);
	if (timeoutMs <= 0)
		return { stdout: "", failure: "timed_out", exitCode: null };

	const binary = resolveBinary();
	if (!binary) return { stdout: "", failure: "not_found", exitCode: null };

	const isolation = detectIsolation();
	let argv: string[];
	if (isolation.mode === "bwrap") {
		argv = sandboxArgv(binary, args, scanDir);
	} else if (allowUnisolated()) {
		argv = [binary, ...args];
	} else {
		return { stdout: "", failure: "isolation_unavailable", exitCode: null };
	}

	try {
		const stdout = execFileSync(argv[0] as string, argv.slice(1), {
			cwd: scanDir,
			env: {
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				HOME: scanDir,
				LANG: "C",
			},
			timeout: timeoutMs,
			killSignal: "SIGKILL",
			maxBuffer: SEARCH_CAPS.maxResultTextBytes * 64,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
		});
		return { stdout, failure: "ok", exitCode: 0 };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & {
			signal?: string;
			status?: number | null;
			killed?: boolean;
			stdout?: string;
		};
		const stdout = err.stdout ?? "";
		// Output cap and wall-clock kill both arrive as a killed child. They are
		// different facts and are reported as different reasons.
		const capped =
			err.code === "ENOBUFS" || /maxBuffer/i.test(err.message ?? "");
		if (capped) return { stdout, failure: "output_capped", exitCode: null };
		if (err.killed === true || err.code === "ETIMEDOUT")
			return { stdout, failure: "timed_out", exitCode: null };
		return {
			stdout,
			failure: "exit_status",
			exitCode: typeof err.status === "number" ? err.status : null,
		};
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

export function probeAnalyzer(budgetMs = 2_000): AnalyzerProbe {
	const isolation = detectIsolation();
	if (isolation.mode === "none" && !allowUnisolated())
		return {
			available: false,
			version: null,
			isolation,
			reason: `analyzer isolation unavailable: ${isolation.reason}`,
		};
	const home = mkdtempSync(join(tmpdir(), "twh-sg-probe-"));
	try {
		const out = runAnalyzer(["--version"], home, budgetMs);
		if (out.failure !== "ok")
			return {
				available: false,
				version: null,
				isolation,
				reason: out.failure,
			};
		const version = /ast-grep\s+([0-9][^\s]*)/.exec(out.stdout)?.[1] ?? null;
		if (!version)
			return {
				available: false,
				version: null,
				isolation,
				reason: "version not reported",
			};
		return { available: true, version, isolation };
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

type SgMatch = {
	file: string;
	range: { byteOffset: { start: number; end: number } };
};

/**
 * Strict parse. Anything unexpected in the analyzer's output is a failure, not an
 * empty match list: silently turning malformed output into "no matches" is the
 * fabricated pass in its most convincing costume.
 */
function parseMatches(stdout: string): SgMatch[] | null {
	const text = stdout.trim();
	if (!text) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const out: SgMatch[] = [];
	for (const item of parsed) {
		const file = (item as SgMatch)?.file;
		const range = (item as SgMatch)?.range?.byteOffset;
		if (typeof file !== "string" || !file) return null;
		if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end))
			return null;
		if (range.start < 0 || range.end < range.start) return null;
		out.push({
			file,
			range: { byteOffset: { start: range.start, end: range.end } },
		});
	}
	return out;
}

export type StructuralResult = SearchEnvelope & {
	analyzer: AnalyzerProbe;
	/** "ok" only when the analyzer ran to completion and its output parsed. */
	failure: RunFailure;
};

function unusableResult(
	snapshotIds: readonly string[],
	coverage: Coverage,
	analyzer: AnalyzerProbe,
	failure: RunFailure,
	staged: number,
): StructuralResult {
	coverage.notIndexed += staged;
	coverage.filesScanned = 0;
	coverage.bytesScanned = 0;
	if (failure === "timed_out") coverage.timeLimited = true;
	if (failure === "output_capped") coverage.byteLimited = true;
	return {
		kind: "search",
		scope: searchScope(snapshotIds),
		entries: [],
		coverage: finalizeCoverage(coverage, true),
		nextCursor: null,
		truncated: {
			is: true,
			reason:
				failure === "timed_out"
					? "time_limit"
					: failure === "output_capped"
						? "response_cap"
						: "page_limit",
		},
		analyzer,
		failure,
	};
}

/**
 * Structural search over already-authorized bytes.
 *
 * One absolute deadline covers the isolation probe, staging, the parse probe and the
 * match run. When it is exhausted the search stops and says so; it never grants a
 * fresh budget to a later phase.
 */
export function structuralSearch(
	entries: readonly ScanEntry[],
	ruleId: string,
	options: { now?: () => number } = {},
): StructuralResult {
	const now = options.now ?? Date.now;
	const started = now();
	const deadline = started + SEARCH_CAPS.wallClockMs;
	const remaining = () => deadline - now();

	const rule = getRule(ruleId);
	const coverage: Coverage = emptyCoverage();
	const snapshotIds = [...new Set(entries.map((e) => e.snapshotId))];
	// The same cap literal search enforces. A helper that documents a limit and then
	// scans past it is worse than one with no limit at all.
	if (snapshotIds.length > SEARCH_CAPS.maxSnapshots)
		throw new SearchInputError(
			`at most ${SEARCH_CAPS.maxSnapshots} snapshots per search`,
		);

	const probe = probeAnalyzer(Math.min(2_000, Math.max(0, remaining())));
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
			failure:
				probe.isolation.mode === "none" ? "isolation_unavailable" : "not_found",
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
			// literal.ts uses, so both modes report the same file the same way.
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

		if (staged.size === 0) {
			return {
				kind: "search",
				scope: searchScope(snapshotIds),
				entries: [],
				coverage: finalizeCoverage(coverage, false),
				nextCursor: null,
				truncated: { is: false },
				analyzer: probe,
				failure: "ok",
			};
		}

		const files = [...staged.keys()];

		// Phase 1: which files do not parse. A failure here means parse status is
		// unknown, and unknown is reported as unknown.
		const parseProbe = runAnalyzer(
			[
				"scan",
				"--inline-rules",
				`id: twh-parse-error\nlanguage: ${rule.language}\nrule:\n  kind: ERROR\n`,
				"--json=compact",
				...files,
			],
			scanDir,
			remaining(),
		);
		if (parseProbe.failure !== "ok")
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				parseProbe.failure,
				staged.size,
			);
		const parsed = parseMatches(parseProbe.stdout);
		if (parsed === null)
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				"invalid_output",
				staged.size,
			);
		const unparsable = new Set(parsed.map((m) => m.file));
		coverage.parseFailed = unparsable.size;

		// Phase 2: the rule itself, on what is left of the same deadline.
		const scan = runAnalyzer(
			[
				"scan",
				"--inline-rules",
				rule.yaml,
				"--json=compact",
				...files.filter((f) => !unparsable.has(f)),
			],
			scanDir,
			remaining(),
		);
		if (scan.failure !== "ok")
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				scan.failure,
				staged.size,
			);
		const matches = parseMatches(scan.stdout);
		if (matches === null)
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				"invalid_output",
				staged.size,
			);

		for (const match of matches) {
			if (findings.length >= SEARCH_CAPS.hitsPerPage) break;
			const entry = staged.get(match.file);
			// A match naming a file we did not stage is not a result we can address.
			if (!entry) {
				return unusableResult(
					snapshotIds,
					coverage,
					probe,
					"invalid_output",
					staged.size,
				);
			}
			const { start, end } = match.range.byteOffset;
			if (end > entry.bytes.byteLength) {
				return unusableResult(
					snapshotIds,
					coverage,
					probe,
					"invalid_output",
					staged.size,
				);
			}
			findings.push(structuralFinding(entry, start, end, rule, probe, started));
		}

		const truncated = matches.length > SEARCH_CAPS.hitsPerPage;
		return {
			kind: "search",
			scope: searchScope(snapshotIds),
			entries: findings,
			coverage: finalizeCoverage(coverage, truncated),
			nextCursor: null,
			truncated: truncated ? { is: true, reason: "page_limit" } : { is: false },
			analyzer: probe,
			failure: "ok",
		};
	} finally {
		// The analyzer's working directory never outlives the request.
		rmSync(scanDir, { recursive: true, force: true });
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
