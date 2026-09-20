import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	accessSync,
	closeSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding, SourceRef } from "../../../generated/types.ts";
import {
	type Coverage,
	emptyCoverage,
	finalizeCoverage,
	objectHashAlgorithm,
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
	/**
	 * How the version run failed, when it ran and failed. Preserved so a caller reports
	 * `timed_out` or `exit_status` as itself instead of flattening every probe failure
	 * to `not_found`, which would read as "no analyzer installed".
	 */
	readonly failure?: RunFailure;
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
		if (FORBIDDEN_ARGS.includes(arg)) {
			throw new Error(`refusing to run the analyzer with ${arg}`);
		}
		if (arg.startsWith("--rewrite") || arg.startsWith("--update")) {
			throw new Error(`refusing to run the analyzer with ${arg}`);
		}
	}
}

/**
 * Resolves an executable on PATH. Resolution is deliberate rather than letting execFile
 * do it: the sandbox has to mount the real file, and a test or a local demonstration
 * that substitutes a controlled executable on PATH must go through the same argv.
 */
function resolveBinary(name = "ast-grep"): string | null {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) {
			continue;
		}
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

function firstBytes(path: string, count: number): Buffer {
	const fd = openSync(path, "r");
	try {
		const buf = Buffer.alloc(count);
		const read = readSync(fd, buf, 0, count, 0);
		return buf.subarray(0, read);
	} finally {
		closeSync(fd);
	}
}

/**
 * What the sandbox must mount for one executable, and nothing else.
 *
 * Follow-up review found the first sandbox mounting `~/.bun` and the analyzer's whole
 * parent directory: read-only, but a sibling file beside the analyzer was readable, and
 * an operator's package tree is not a selected input. Only the exact executable file is
 * mounted now, at a fixed path, plus its shebang interpreter when it is a script.
 *
 * The npm `ast-grep` entry on PATH is a JS shim that spawns a platform binary; a shim
 * cannot run with its package directory unmounted. So resolution prefers the native ELF:
 * `THINKWIDE_ANALYZER_BIN` if set, else the PATH entry when it is already an ELF, else
 * the platform package binary beside the shim. Anything else is reported as unavailable
 * rather than mounting a directory to make it work.
 */
export type AnalyzerImage = {
	/** Absolute host path of the file to execute. */
	readonly binary: string;
	/** Extra single files the sandbox must mount (a script's interpreter). */
	readonly extraFiles: readonly string[];
};

export function resolveAnalyzerImage(): AnalyzerImage | null {
	const configured = process.env.THINKWIDE_ANALYZER_BIN;
	const candidate = configured
		? existsSync(configured)
			? realpathSync(configured)
			: null
		: resolveBinary();
	if (!candidate) {
		return null;
	}

	let head: Buffer;
	try {
		head = firstBytes(candidate, 128);
	} catch {
		return null;
	}

	// Native executable: mount exactly this file.
	if (head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
		return { binary: candidate, extraFiles: [] };
	}

	// A script: mount the script and its interpreter, never their directories.
	if (head.subarray(0, 2).toString("latin1") === "#!") {
		const line = head.toString("utf8").split("\n", 1)[0] ?? "";
		const parts = line.slice(2).trim().split(/\s+/);
		let interpreter: string | undefined = parts[0];
		// `#!/usr/bin/env node` resolves through PATH inside the sandbox, where PATH is
		// /usr/bin:/bin; the platform binary below is preferred for the real analyzer.
		if (interpreter?.endsWith("/env") && parts[1]) {
			interpreter = resolveBinary(parts[1]) ?? undefined;
		}
		const native = nativeSibling(candidate);
		if (native) {
			return { binary: native, extraFiles: [] };
		}
		if (interpreter && existsSync(interpreter)) {
			return { binary: candidate, extraFiles: [interpreter] };
		}
	}
	return null;
}

/**
 * For the npm layout only: `<...>/node_modules/@ast-grep/cli/ast-grep` has its real
 * binary in a sibling platform package. The result must itself be an ELF file.
 */
function nativeSibling(shim: string): string | null {
	const pkgDir = dirname(shim);
	const scope = dirname(pkgDir);
	let names: string[];
	try {
		names = readdirSync(scope);
	} catch {
		return null;
	}
	for (const name of names.sort()) {
		if (!name.startsWith("cli-")) {
			continue;
		}
		const candidate = join(scope, name, "ast-grep");
		try {
			accessSync(candidate, constants.X_OK);
			const head = firstBytes(candidate, 4);
			if (head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
				return realpathSync(candidate);
			}
		} catch {
			// keep looking
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

/**
 * Forgets the cached isolation profile and the cached analyzer probe so the next call
 * measures both again. Tests use this to exercise the cold path; nothing in a request
 * path should need it.
 */
export function resetIsolationCache(): void {
	isolationCache = null;
	probeCache = null;
}

/**
 * Probes the isolation profile once per process, inside the caller's budget.
 *
 * The budget matters: follow-up review measured a cold start at 6,114 ms against a 5 s
 * cap because detection held a timeout of its own.
 *
 * Two results are deliberately NOT cached, because caching them would turn a momentary
 * condition into a permanent one: a profile that could not be probed inside the budget,
 * and a probe killed by its timeout. A definitive answer — the profile works, or the
 * tools are missing — is cached.
 */
export function detectIsolation(
	options: { force?: boolean; budgetMs?: number } = {},
): Isolation {
	const budget = options.budgetMs ?? 5_000;
	if (options.force) {
		isolationCache = null;
	}
	if (isolationCache) {
		return isolationCache;
	}
	if (budget <= 0) {
		return {
			mode: "none",
			reason: "deadline exhausted before isolation probe",
		};
	}
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
			{ timeout: budget, stdio: "ignore", shell: false },
		);
		isolationCache = {
			mode: "bwrap",
			memoryBytes: ISOLATION_LIMITS.memoryBytes,
			cpuSeconds: ISOLATION_LIMITS.cpuSeconds,
		};
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { killed?: boolean };
		const timedOut = err.killed === true || err.code === "ETIMEDOUT";
		const result: Isolation = {
			mode: "none",
			reason: timedOut
				? `isolation probe exceeded its ${budget} ms budget`
				: err.message,
		};
		// A probe we ran out of time for says nothing about the host. Do not cache it.
		if (!timedOut) {
			isolationCache = result;
		}
		return result;
	}
	return isolationCache;
}

/** Where the analyzer file is mounted inside the sandbox. */
const SANDBOX_BINARY = "/analyzer/ast-grep";

/**
 * Builds the confined argv. The scanned bytes are mounted read-only at /scan and the
 * analyzer is mounted as a single file at /analyzer/ast-grep. No host directory outside
 * the read-only system paths is visible.
 */
function sandboxArgv(
	image: AnalyzerImage,
	args: readonly string[],
	scanDir: string,
): string[] {
	const prlimit = resolveBinary("prlimit") as string;
	const bwrap = resolveBinary("bwrap") as string;
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
		// tmpfs first, then the binds that live under /tmp, or they are covered over.
		"--tmpfs",
		"/tmp",
		"--dir",
		"/sbx",
		// Exactly one executable file, plus a script's interpreter when there is one.
		// Never a directory: a sibling of the analyzer is not a selected input.
		"--ro-bind",
		image.binary,
		SANDBOX_BINARY,
		...image.extraFiles.flatMap((file) => ["--ro-bind", file, file]),
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
		SANDBOX_BINARY,
		...args,
	];
}

/**
 * Runs the analyzer under the isolation profile within one absolute deadline.
 *
 * `timeoutMs` is the budget for EVERYTHING this call does, not for the subprocess
 * alone. Follow-up review measured a 1,500 ms budget taking 2,510 ms and returning
 * success, because detection got the full budget and then execution got it again. The
 * deadline is computed once on entry and every step is charged against it.
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
	const deadline = Date.now() + timeoutMs;
	const remaining = () => deadline - Date.now();
	if (timeoutMs <= 0) {
		return { stdout: "", failure: "timed_out", exitCode: null };
	}

	const image = resolveAnalyzerImage();
	if (!image) {
		return { stdout: "", failure: "not_found", exitCode: null };
	}

	// Detection spends this call's budget; it does not hold a timeout of its own.
	const isolation = detectIsolation({ budgetMs: remaining() });
	let argv: string[];
	if (isolation.mode === "bwrap") {
		argv = sandboxArgv(image, args, scanDir);
	} else if (allowUnisolated()) {
		argv = [image.binary, ...args];
	} else {
		return { stdout: "", failure: "isolation_unavailable", exitCode: null };
	}

	// Whatever setup cost, the subprocess only gets what is left.
	const budget = remaining();
	if (budget <= 0) {
		return { stdout: "", failure: "timed_out", exitCode: null };
	}

	try {
		const stdout = execFileSync(argv[0] as string, argv.slice(1), {
			cwd: scanDir,
			env: {
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				HOME: scanDir,
				LANG: "C",
			},
			timeout: budget,
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
		if (capped) {
			return { stdout, failure: "output_capped", exitCode: null };
		}
		if (err.killed === true || err.code === "ETIMEDOUT") {
			return { stdout, failure: "timed_out", exitCode: null };
		}
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
		if (!id || !language) {
			throw new Error(`rule ${file} must declare id and language`);
		}
		if (/^\s*fix:/m.test(yaml)) {
			throw new Error(
				`rule ${file} declares a fix; this product never rewrites source`,
			);
		}
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
	if (!rule) {
		throw new SearchInputError(`unknown ruleId: ${ruleId}`);
	}
	return rule;
}

/**
 * Identity of the thing a successful probe describes. A cached version must not outlive
 * a change of analyzer, so the key covers the resolved file, its size and mtime, the
 * inputs that select it, and the isolation mode it was probed under.
 */
function probeCacheKey(
	image: AnalyzerImage,
	isolation: Isolation,
): string | null {
	try {
		const stat = statSync(image.binary);
		return JSON.stringify({
			binary: image.binary,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			extraFiles: image.extraFiles,
			isolation: isolation.mode,
			configured: process.env.THINKWIDE_ANALYZER_BIN ?? null,
			path: process.env.PATH ?? null,
		});
	} catch {
		return null;
	}
}

let probeCache: { key: string; probe: AnalyzerProbe } | null = null;

export function probeAnalyzer(budgetMs = 2_000): AnalyzerProbe {
	// One deadline for detection and the version run together: a cold start cannot
	// spend the budget on detection and then start the subprocess with a fresh copy.
	const deadline = Date.now() + budgetMs;
	const remaining = () => deadline - Date.now();
	const isolation = detectIsolation({ budgetMs: remaining() });
	if (isolation.mode === "none" && !allowUnisolated()) {
		return {
			available: false,
			version: null,
			isolation,
			reason: `analyzer isolation unavailable: ${isolation.reason}`,
		};
	}

	// A successful probe is reused, because otherwise every search spends up to 2 s of
	// its 5 s deadline launching a sandboxed `--version` before staging a single file.
	// Only successes are cached, and only against the exact analyzer identity: findings
	// record `extractor.version`, so a stale version would misattribute evidence.
	const image = resolveAnalyzerImage();
	const key = image ? probeCacheKey(image, isolation) : null;
	if (key && probeCache?.key === key) {
		return probeCache.probe;
	}

	const home = mkdtempSync(join(tmpdir(), "twh-sg-probe-"));
	try {
		const out = runAnalyzer(["--version"], home, remaining());
		if (out.failure !== "ok") {
			return {
				available: false,
				version: null,
				isolation,
				reason: out.failure,
				failure: out.failure,
			};
		}
		const version = /ast-grep\s+([0-9][^\s]*)/.exec(out.stdout)?.[1] ?? null;
		if (!version) {
			return {
				available: false,
				version: null,
				isolation,
				reason: "version not reported",
			};
		}
		const probe: AnalyzerProbe = { available: true, version, isolation };
		if (key) {
			probeCache = { key, probe };
		}
		return probe;
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
	if (!text) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) {
		return null;
	}
	const out: SgMatch[] = [];
	for (const item of parsed) {
		const file = (item as SgMatch)?.file;
		const range = (item as SgMatch)?.range?.byteOffset;
		if (typeof file !== "string" || !file) {
			return null;
		}
		if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end)) {
			return null;
		}
		if (range.start < 0 || range.end < range.start) {
			return null;
		}
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
	if (failure === "timed_out") {
		coverage.timeLimited = true;
	}
	if (failure === "output_capped") {
		coverage.byteLimited = true;
	}
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
	if (snapshotIds.length > SEARCH_CAPS.maxSnapshots) {
		throw new SearchInputError(
			`at most ${SEARCH_CAPS.maxSnapshots} snapshots per search`,
		);
	}

	// Isolation detection and the version probe are subprocesses too, and a cold start
	// pays for both. They come out of the same deadline as the scan phases.
	const probe = probeAnalyzer(Math.min(2_000, Math.max(0, remaining())));
	if (!probe.available) {
		coverage.notIndexed = entries.length;
		const outOfTime = remaining() <= 0;
		if (outOfTime) {
			coverage.timeLimited = true;
		}
		return {
			kind: "search",
			scope: searchScope(snapshotIds),
			entries: [],
			coverage: finalizeCoverage(coverage, outOfTime),
			nextCursor: null,
			truncated: outOfTime ? { is: true, reason: "time_limit" } : { is: false },
			analyzer: probe,
			// The probe's own failure is reported as itself. Flattening timed_out or
			// exit_status to not_found would read as "no analyzer is installed", which
			// is a different thing to go and fix.
			failure: outOfTime
				? "timed_out"
				: probe.isolation.mode === "none"
					? "isolation_unavailable"
					: (probe.failure ?? "not_found"),
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
			// Staging writes files, so it can run long on a large selection. It is inside
			// the deadline like every other phase.
			if (remaining() <= 0) {
				coverage.notIndexed++;
				coverage.timeLimited = true;
				continue;
			}
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
		if (parseProbe.failure !== "ok") {
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				parseProbe.failure,
				staged.size,
			);
		}
		const parsed = parseMatches(parseProbe.stdout);
		if (parsed === null) {
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				"invalid_output",
				staged.size,
			);
		}
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
		if (scan.failure !== "ok") {
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				scan.failure,
				staged.size,
			);
		}
		const matches = parseMatches(scan.stdout);
		if (matches === null) {
			return unusableResult(
				snapshotIds,
				coverage,
				probe,
				"invalid_output",
				staged.size,
			);
		}

		for (const match of matches) {
			if (findings.length >= SEARCH_CAPS.hitsPerPage) {
				break;
			}
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
		hashAlgorithm: objectHashAlgorithm(entry),
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
