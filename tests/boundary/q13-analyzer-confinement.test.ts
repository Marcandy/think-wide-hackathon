import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_CAPS } from "../../src/server/search/caps.ts";
import {
	assertNoMutatingArgs,
	detectIsolation,
	loadRules,
	probeAnalyzer,
	resetIsolationCache,
	runAnalyzer,
	structuralSearch,
} from "../../src/server/search/structural.ts";
import { CORPUS } from "../fixtures/search/corpus.ts";

/**
 * T07 · Q13 — native analyzer confinement.
 *
 * Layer: unit/local, with the real ast-grep binary and with controlled instrumented
 * executables substituted on PATH so the PRODUCTION runner is what gets exercised.
 *
 * The first version of this suite asserted confinement by re-implementing the
 * environment inside the test. Independent review was right that this proves nothing:
 * changing production `cleanEnv` would not have failed it. Every test below now goes
 * through `runAnalyzer` or `structuralSearch`, so weakening the runner fails the suite.
 *
 * Fault injection substitutes a synthetic executable through PATH. That establishes
 * what OUR boundary permits; it is not a claim about ast-grep itself, and no real
 * secret, host path or network service is touched.
 *
 * NOT established here: deployed/hosted isolation, seccomp syscall filtering, and
 * behavior at real repository scale. Q13 application acceptance stays NOT RUN until the
 * analyzer runs behind a real handler on T05 snapshots.
 */

/** Deliberately larger than the runner's address-space ceiling. */
const ISOLATION_OVER_LIMIT = 4 * 1024 * 1024 * 1024;

const isolation = detectIsolation();
const confined = isolation.mode === "bwrap";
const probe = probeAnalyzer();
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Files the analyzer has no business touching, outside every scan directory. */
let outsideDir: string;
let canaryFile: string;
let writeTarget: string;
const CANARY_TEXT = "SYNTHETIC_CANARY_NOT_FOR_ANALYZER_ce9f1d";

beforeAll(() => {
	outsideDir = mkdtempSync(join(tmpdir(), "twh-q13-outside-"));
	canaryFile = join(outsideDir, "canary.txt");
	writeTarget = join(outsideDir, "written-by-analyzer.txt");
	writeFileSync(canaryFile, CANARY_TEXT);
});

afterAll(() => {
	if (outsideDir) rmSync(outsideDir, { recursive: true, force: true });
});

/**
 * Installs a synthetic executable as `ast-grep` on PATH and runs `body` through the
 * production runner. PATH is restored afterwards.
 */
function withInstrumentedAnalyzer<T>(
	script: string,
	body: (scanDir: string) => T,
	extra: { siblingCanary?: string; slowBwrapMs?: number } = {},
): T {
	const root = mkdtempSync(join(tmpdir(), "twh-q13-instr-"));
	const bin = join(root, "bin");
	const scanDir = join(root, "scan");
	mkdirSync(bin);
	mkdirSync(scanDir);
	writeFileSync(join(scanDir, "a.ts"), "export function a() {}\n");
	const file = join(bin, "ast-grep");
	writeFileSync(file, `#!/usr/bin/node\n${script}\n`);
	chmodSync(file, 0o755);
	// A file that happens to sit beside the analyzer. It is not a selected input, so
	// the sandbox must not expose it just because the analyzer lives in that directory.
	if (extra.siblingCanary)
		writeFileSync(join(bin, "sibling-canary.txt"), extra.siblingCanary);
	// A delayed bwrap, used to charge the isolation probe real time on a cold start.
	if (extra.slowBwrapMs) {
		const realBwrap = execFileSync("bash", ["-lc", "command -v bwrap"], {
			encoding: "utf8",
		}).trim();
		const wrapper = join(bin, "bwrap");
		writeFileSync(
			wrapper,
			`#!/usr/bin/node\nconst end = Date.now() + ${extra.slowBwrapMs}; while (Date.now() < end) {}\nrequire("node:child_process").spawnSync(${JSON.stringify(realBwrap)}, process.argv.slice(2), { stdio: "inherit" })\n`,
		);
		chmodSync(wrapper, 0o755);
	}
	const originalPath = process.env.PATH;
	// Prepended, not replacing: the instrumented executable must win the PATH lookup
	// for `ast-grep` while the runner still resolves its real sandbox tools.
	process.env.PATH = `${bin}:${originalPath ?? ""}`;
	try {
		return body(scanDir);
	} finally {
		process.env.PATH = originalPath;
		rmSync(root, { recursive: true, force: true });
	}
}

describe("Q13 analyzer argv", () => {
	it("refuses rewrite, update and interactive flags", () => {
		for (const bad of [
			"-U",
			"--update-all",
			"--rewrite",
			"--rewrite=x",
			"-i",
			"--interactive",
		]) {
			expect(() => assertNoMutatingArgs(["scan", bad])).toThrowError(
				/refusing/,
			);
		}
	});

	it("refuses flags that would load configuration from the scanned tree", () => {
		for (const bad of ["--config", "-r"]) {
			expect(() =>
				assertNoMutatingArgs(["scan", bad, "sgconfig.yml"]),
			).toThrowError(/refusing/);
		}
	});

	it("passes a reviewed rule as one argument, so nothing is shell-interpolated", () => {
		const rule = loadRules()[0];
		// Rule text carries newlines, colons and $ metavariables. If any of this were
		// ever concatenated into a shell command line it would be an injection point;
		// execFile with an argv array is what keeps it inert.
		const args = [
			"scan",
			"--inline-rules",
			rule.yaml,
			"--json=compact",
			"s/a.ts",
		];
		expect(() => assertNoMutatingArgs(args)).not.toThrow();
		expect(args.filter((a) => a === rule.yaml)).toHaveLength(1);
	});
});

describe("Q13 isolation profile", () => {
	it("reports which profile is in force", () => {
		// This is the one test that must run everywhere: the profile is either active,
		// or structural capability must be missing. There is no third state where the
		// analyzer runs unconfined and results are still presented as trustworthy.
		if (confined) {
			expect(isolation).toMatchObject({ mode: "bwrap" });
			expect(isolation.memoryBytes).toBeGreaterThan(0);
		} else {
			expect(isolation.mode).toBe("none");
			expect(probe.available).toBe(false);
			const result = structuralSearch(CORPUS, "exported-function-declaration");
			expect(result.entries).toHaveLength(0);
			expect(result.coverage.status).toBe("not_indexed");
			expect(result.failure).toBe("isolation_unavailable");
		}
	});

	it.runIf(confined)(
		"refuses to run the analyzer when isolation is absent",
		() => {
			// Simulated by pointing the runner at a PATH with no bwrap: the runner must
			// return isolation_unavailable rather than falling back to an unconfined run.
			const empty = mkdtempSync(join(tmpdir(), "twh-q13-nopath-"));
			const originalPath = process.env.PATH;
			try {
				process.env.PATH = empty;
				const out = runAnalyzer(["--version"], empty, 2_000);
				expect(["isolation_unavailable", "not_found"]).toContain(out.failure);
				expect(out.stdout).toBe("");
			} finally {
				process.env.PATH = originalPath;
				detectIsolation({ force: true });
				rmSync(empty, { recursive: true, force: true });
			}
		},
	);
});

describe.runIf(confined)(
	"Q13 confinement, through the production runner",
	() => {
		it("hands the analyzer exactly PATH, HOME and LANG", () => {
			const marker = "SYNTHETIC_SECRET_9f2a";
			process.env.TWH_FAKE_PROVIDER_TOKEN = marker;
			try {
				const out = withInstrumentedAnalyzer(
					"process.stdout.write(JSON.stringify(process.env))",
					(scanDir) => runAnalyzer(["--version"], scanDir, 10_000),
				);
				expect(out.failure).toBe("ok");
				const childEnv = JSON.parse(out.stdout) as Record<string, string>;
				// PWD is set by the sandbox's own chdir; nothing is inherited from us.
				expect(Object.keys(childEnv).sort()).toEqual([
					"HOME",
					"LANG",
					"PATH",
					"PWD",
				]);
				expect(childEnv.PWD).toBe("/scan");
				expect(out.stdout).not.toContain(marker);
				// The sandbox's own values, not this process's.
				expect(childEnv.PATH).toBe("/usr/bin:/bin");
				expect(childEnv.HOME).toBe("/sbx");
			} finally {
				delete process.env.TWH_FAKE_PROVIDER_TOKEN;
			}
		});

		it("cannot read a file outside the mounted scan directory", () => {
			const out = withInstrumentedAnalyzer(
				`try { process.stdout.write("READ:" + require("node:fs").readFileSync(${JSON.stringify(canaryFile)}, "utf8")) } catch (e) { process.stdout.write("DENIED:" + e.code) }`,
				(scanDir) => runAnalyzer(["--version"], scanDir, 10_000),
			);
			expect(out.stdout).not.toContain(CANARY_TEXT);
			expect(out.stdout.startsWith("DENIED:")).toBe(true);
			// The canary itself is untouched.
			expect(readFileSync(canaryFile, "utf8")).toBe(CANARY_TEXT);
		});

		it("cannot write outside the mounted scan directory", () => {
			const out = withInstrumentedAnalyzer(
				`try { require("node:fs").writeFileSync(${JSON.stringify(writeTarget)}, "SYNTHETIC"); process.stdout.write("WROTE") } catch (e) { process.stdout.write("DENIED:" + e.code) }`,
				(scanDir) => runAnalyzer(["--version"], scanDir, 10_000),
			);
			expect(out.stdout).not.toContain("WROTE");
			expect(existsSync(writeTarget)).toBe(false);
		});

		it("cannot write into its own read-only scan mount", () => {
			const out = withInstrumentedAnalyzer(
				`try { require("node:fs").writeFileSync("/scan/evil.ts", "SYNTHETIC"); process.stdout.write("WROTE") } catch (e) { process.stdout.write("DENIED:" + e.code) }`,
				(scanDir) => {
					const result = runAnalyzer(["--version"], scanDir, 10_000);
					expect(existsSync(join(scanDir, "evil.ts"))).toBe(false);
					return result;
				},
			);
			expect(out.stdout).not.toContain("WROTE");
		});

		it("cannot read a file sitting beside the analyzer itself", () => {
			// Follow-up review: the first sandbox mounted the analyzer's whole parent
			// directory, so an unrelated sibling was readable. Only the executable file
			// is mounted now, and this is the regression that says so.
			const sibling = "SYNTHETIC_UNSELECTED_SIBLING_4a21";
			const out = withInstrumentedAnalyzer(
				[
					'const fs = require("node:fs")',
					'let seen = "DENIED"',
					'try { seen = fs.readdirSync("/analyzer").join(",") } catch (e) { seen = "DENIED:" + e.code }',
					'let read = "DENIED"',
					'try { read = fs.readFileSync("/analyzer/sibling-canary.txt", "utf8") } catch (e) { read = "DENIED:" + e.code }',
					"process.stdout.write(JSON.stringify({ seen, read }))",
				].join("\n"),
				(scanDir) => runAnalyzer(["--version"], scanDir, 10_000),
				{ siblingCanary: sibling },
			);
			expect(out.stdout).not.toContain(sibling);
			const observed = JSON.parse(out.stdout) as {
				seen: string;
				read: string;
			};
			// /analyzer holds the mounted executable and nothing else.
			expect(observed.seen).toBe("ast-grep");
			expect(observed.read.startsWith("DENIED:")).toBe(true);
		});

		it("has no network, against a listener this test proves is reachable", async () => {
			// Positive control first: ECONNREFUSED on its own proves nothing, because a
			// closed port refuses with or without isolation. So a real listener is
			// started, an unsandboxed child connects to it, and only then is the same
			// connection attempted from inside the sandbox.
			const server = createServer();
			try {
				await new Promise<void>((resolve) => {
					server.listen(0, "127.0.0.1", resolve);
				});
				const port = (server.address() as AddressInfo).port;
				const connectScript = [
					'const net = require("node:net")',
					`const s = net.connect({ host: "127.0.0.1", port: ${port} })`,
					's.on("connect", () => { process.stdout.write("CONNECTED"); process.exit(0) })',
					's.on("error", (e) => { process.stdout.write("DENIED:" + e.code); process.exit(0) })',
					'setTimeout(() => { process.stdout.write("DENIED:timeout"); process.exit(0) }, 2000)',
				].join("\n");

				const control = execFileSync("/usr/bin/node", ["-e", connectScript], {
					encoding: "utf8",
					timeout: 10_000,
				});
				expect(control).toBe("CONNECTED");

				const sandboxed = withInstrumentedAnalyzer(connectScript, (scanDir) =>
					runAnalyzer(["--version"], scanDir, 10_000),
				);
				expect(sandboxed.stdout).not.toContain("CONNECTED");
				expect(sandboxed.stdout.startsWith("DENIED:")).toBe(true);
			} finally {
				server.close();
			}
		});

		it("enforces an address-space limit, and allows an allocation under it", () => {
			// Positive control: a small allocation must succeed, otherwise "no ALLOCATED"
			// would pass even if the sandbox could not run node at all.
			const under = withInstrumentedAnalyzer(
				`try { const b = Buffer.alloc(64 * 1024 * 1024); process.stdout.write("ALLOCATED:" + b.length) } catch (e) { process.stdout.write("DENIED:" + e.message) }`,
				(scanDir) => runAnalyzer(["--version"], scanDir, 20_000),
			);
			expect(under.failure).toBe("ok");
			expect(under.stdout).toBe(`ALLOCATED:${64 * 1024 * 1024}`);

			const over = withInstrumentedAnalyzer(
				`try { const b = Buffer.alloc(${ISOLATION_OVER_LIMIT}); process.stdout.write("ALLOCATED:" + b.length) } catch (e) { process.stdout.write("DENIED") }`,
				(scanDir) => runAnalyzer(["--version"], scanDir, 20_000),
			);
			// Either the allocation is refused in-process or the process is killed by the
			// limit. Both are acceptable; succeeding is not.
			expect(over.stdout).not.toContain("ALLOCATED");
		});
	},
);

describe.runIf(probe.available)("Q13 real-binary behavior", () => {
	it("reads only the bytes handed to it: the outside canary never appears", () => {
		const result = structuralSearch(CORPUS, "exported-function-declaration");
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain(CANARY_TEXT);
		expect(serialized).not.toContain(outsideDir);
		expect(readFileSync(canaryFile, "utf8")).toBe(CANARY_TEXT);
	});

	it("never resolves the escape symlink entry", () => {
		const result = structuralSearch(CORPUS, "exported-function-declaration");
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("/etc/passwd");
		expect(serialized).not.toContain("root:");
		expect(result.coverage.excluded).toBeGreaterThanOrEqual(1);
	});

	it("leaves the fixture bytes unchanged", () => {
		const before = CORPUS.map((e) => sha256(e.bytes));
		structuralSearch(CORPUS, "dynamic-code-execution");
		expect(CORPUS.map((e) => sha256(e.bytes))).toEqual(before);
	});

	it("removes its working directory, leaving no scan temp dirs behind", () => {
		const before = readdirSync(tmpdir()).filter((n) =>
			n.startsWith("twh-sg-scan-"),
		);
		structuralSearch(CORPUS, "exported-function-declaration");
		const after = readdirSync(tmpdir()).filter((n) =>
			n.startsWith("twh-sg-scan-"),
		);
		expect(after.length).toBeLessThanOrEqual(before.length);
		for (const dir of after) expect(before).toContain(dir);
	});

	it("writes nothing into the repository working tree", () => {
		const repoRoot = join(import.meta.dirname, "..", "..");
		const status = execFileSync("git", ["status", "--porcelain"], {
			cwd: repoRoot,
			encoding: "utf8",
		});
		structuralSearch(CORPUS, "exported-function-declaration");
		const after = execFileSync("git", ["status", "--porcelain"], {
			cwd: repoRoot,
			encoding: "utf8",
		});
		expect(after).toBe(status);
	});

	it("kills and reaps an analyzer that outruns its budget", () => {
		const scanDir = mkdtempSync(join(tmpdir(), "twh-q13-timeout-"));
		try {
			writeFileSync(
				join(scanDir, "big.ts"),
				'const x = "SYNTHETIC"\n'.repeat(20_000),
			);
			const started = Date.now();
			const out = runAnalyzer(
				[
					"scan",
					"--inline-rules",
					"id: twh-timeout-probe\nlanguage: TypeScript\nrule:\n  kind: ERROR\n",
					"--json=compact",
					"big.ts",
				],
				scanDir,
				1,
			);
			expect(out.failure).not.toBe("ok");
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(out.stdout.length).toBeLessThanOrEqual(
				SEARCH_CAPS.maxResultTextBytes * 64,
			);
			const surviving = execFileSync(
				"bash",
				["-lc", "pgrep -c ast-grep || true"],
				{ encoding: "utf8" },
			).trim();
			expect(Number(surviving)).toBe(0);
		} finally {
			rmSync(scanDir, { recursive: true, force: true });
		}
	});
});

describe.runIf(confined)(
	"Q13 failure honesty, through the production runner",
	() => {
		const knownMatch = [
			{
				...CORPUS[0],
				bytes: Buffer.from("export function a() {}\n", "utf8"),
				path: "a.ts",
			},
		];

		it("does not report complete coverage when the analyzer exits nonzero", () => {
			const result = withInstrumentedAnalyzer(
				'if (process.argv.includes("--version")) { console.log("ast-grep 0.45.3") } else { process.exit(2) }',
				() => structuralSearch(knownMatch, "exported-function-declaration"),
			);
			expect(result.entries).toHaveLength(0);
			expect(result.failure).toBe("exit_status");
			expect(result.coverage.status).not.toBe("complete");
			expect(result.coverage.filesScanned).toBe(0);
			expect(result.coverage.notIndexed).toBeGreaterThan(0);
		});

		it("does not report complete coverage when the analyzer emits invalid JSON", () => {
			const result = withInstrumentedAnalyzer(
				'if (process.argv.includes("--version")) { console.log("ast-grep 0.45.3") } else { console.log("not-json") }',
				() => structuralSearch(knownMatch, "exported-function-declaration"),
			);
			expect(result.entries).toHaveLength(0);
			expect(result.failure).toBe("invalid_output");
			expect(result.coverage.status).not.toBe("complete");
		});

		it("rejects output whose byte range does not fit the staged bytes", () => {
			const result = withInstrumentedAnalyzer(
				[
					'if (process.argv.includes("--version")) { console.log("ast-grep 0.45.3") }',
					'else if (process.argv.join(" ").includes("twh-parse-error")) { console.log("[]") }',
					"else { const f = process.argv[process.argv.length - 1]; console.log(JSON.stringify([{file: f, range: {byteOffset: {start: 0, end: 999999}}}])) }",
				].join("\n"),
				() => structuralSearch(knownMatch, "exported-function-declaration"),
			);
			expect(result.entries).toHaveLength(0);
			expect(result.failure).toBe("invalid_output");
		});

		it("holds the deadline on a cold start, when isolation is probed first", () => {
			// Follow-up review measured 6,114 ms because isolation detection held a timeout
			// of its own. The cache is cleared here so detection, the version probe and the
			// scan phases all compete for the one request budget.
			const started = Date.now();
			const result = withInstrumentedAnalyzer(
				[
					'if (process.argv.includes("--version")) { const end = Date.now() + 1500; while (Date.now() < end) {} ; console.log("ast-grep 0.45.3") }',
					'else { console.log("[]") }',
				].join("\n"),
				() => {
					resetIsolationCache();
					return structuralSearch(knownMatch, "exported-function-declaration");
				},
				{ slowBwrapMs: 4_500 },
			);
			const elapsed = Date.now() - started;
			try {
				expect(elapsed).toBeLessThan(SEARCH_CAPS.wallClockMs + 1_500);
				expect(result.entries).toHaveLength(0);
				expect(result.coverage.status).not.toBe("complete");
				expect(result.failure).not.toBe("ok");
			} finally {
				// Restore a real profile for the rest of the run.
				detectIsolation({ force: true });
			}
		});

		it("holds one deadline across both analyzer phases", () => {
			// Each phase sleeps for most of the budget. A per-phase budget lets the request
			// run to roughly twice the cap, which is what review observed at 6,015 ms.
			const started = Date.now();
			const result = withInstrumentedAnalyzer(
				[
					'if (process.argv.includes("--version")) { console.log("ast-grep 0.45.3") }',
					'else { const end = Date.now() + 3000; while (Date.now() < end) {} ; console.log("[]") }',
				].join("\n"),
				() => structuralSearch(knownMatch, "exported-function-declaration"),
			);
			const elapsed = Date.now() - started;
			expect(elapsed).toBeLessThan(SEARCH_CAPS.wallClockMs + 1_500);
			expect(result.coverage.status).not.toBe("complete");
			expect(result.coverage.timeLimited || result.failure !== "ok").toBe(true);
		});
	},
);
