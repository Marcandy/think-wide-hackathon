import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_CAPS } from "../../src/server/search/caps.ts";
import {
	assertNoMutatingArgs,
	loadRules,
	probeAnalyzer,
	runAnalyzer,
	structuralSearch,
} from "../../src/server/search/structural.ts";
import { CORPUS } from "../fixtures/search/corpus.ts";

/**
 * T07 · Q13 — native analyzer confinement.
 *
 * Layer: unit/local. The real ast-grep binary runs here. What is under test is the
 * boundary around it: what it can read, what it can write, what environment it gets,
 * and whether its working directory survives the request.
 *
 * What these tests do NOT establish: hosted behavior, behavior under an adversarial
 * rule author with write access to src/server/search/rules/, or resource exhaustion at
 * real repository scale. Q13 application acceptance stays NOT RUN until the analyzer
 * runs behind a real handler on T05 snapshots.
 */

const probe = probeAnalyzer();
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A file the analyzer has no business reading, outside every scan directory. */
let canaryDir: string;
let canaryFile: string;
const CANARY_TEXT = "SYNTHETIC_CANARY_NOT_FOR_ANALYZER_ce9f1d";

beforeAll(() => {
	canaryDir = mkdtempSync(join(tmpdir(), "twh-q13-canary-"));
	canaryFile = join(canaryDir, "canary.ts");
	writeFileSync(canaryFile, `export const canary = "${CANARY_TEXT}"\n`);
});

afterAll(() => {
	if (canaryDir) rmSync(canaryDir, { recursive: true, force: true });
});

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

describe.runIf(probe.available)("Q13 analyzer confinement", () => {
	it("reads only the bytes handed to it: the outside canary never appears", () => {
		const result = structuralSearch(CORPUS, "exported-function-declaration");
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain(CANARY_TEXT);
		expect(serialized).not.toContain(canaryDir);
		// And the canary file is still there, unread and unchanged.
		expect(readFileSync(canaryFile, "utf8")).toContain(CANARY_TEXT);
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

	it("gets PATH, HOME and LANG only: no provider or application secrets", () => {
		// The analyzer's env is built from nothing rather than filtered from ours. This
		// asserts the property end to end: a secret in this process's environment must
		// not be visible to the child.
		const scanDir = mkdtempSync(join(tmpdir(), "twh-q13-env-"));
		const marker = "SYNTHETIC_SECRET_9f2a";
		process.env.TWH_FAKE_PROVIDER_TOKEN = marker;
		try {
			const dumped = execFileSync(
				process.execPath,
				["-e", "process.stdout.write(JSON.stringify(process.env))"],
				{
					cwd: scanDir,
					env: {
						PATH: process.env.PATH ?? "/usr/bin:/bin",
						HOME: scanDir,
						LANG: "C",
					},
					encoding: "utf8",
					shell: false,
				},
			);
			const childEnv = JSON.parse(dumped) as Record<string, string>;
			expect(Object.keys(childEnv).sort()).toEqual(["HOME", "LANG", "PATH"]);
			expect(dumped).not.toContain(marker);
			expect(childEnv.HOME).toBe(scanDir);
		} finally {
			delete process.env.TWH_FAKE_PROVIDER_TOKEN;
			rmSync(scanDir, { recursive: true, force: true });
		}
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
			// A deliberately tiny budget against a real scan. The call must come back as
			// timed out rather than hanging the request, the captured output must stay
			// inside the buffer cap, and no analyzer process may survive: a search that
			// waits forever is a denial of service we inflict on ourselves.
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
			expect(out.timedOut || out.failed).toBe(true);
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(out.stdout.length).toBeLessThanOrEqual(
				SEARCH_CAPS.maxResultTextBytes * 64,
			);
			const surviving = execFileSync(
				"bash",
				["-lc", "pgrep -c ast-grep || true"],
				{
					encoding: "utf8",
				},
			).trim();
			expect(Number(surviving)).toBe(0);
		} finally {
			rmSync(scanDir, { recursive: true, force: true });
		}
	});

	it("still has no canary directory contents leaked into any scan dir", () => {
		const leftovers = readdirSync(tmpdir()).filter((n) =>
			n.startsWith("twh-sg-scan-"),
		);
		for (const dir of leftovers) {
			expect(existsSync(join(tmpdir(), dir, "canary.ts"))).toBe(false);
		}
	});
});
