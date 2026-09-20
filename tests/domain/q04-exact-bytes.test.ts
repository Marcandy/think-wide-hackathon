import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ResultEnvelope as validEnvelope,
	Evidence as validEvidence,
} from "../../generated/validators.js";
import { assertObjectId } from "../../src/server/git/process";
import { readSource } from "../../src/server/git/read-blob";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import { browseSnapshot } from "../../src/server/git/tree";
import {
	BYTE_CASES,
	bundlePath,
	EMOJI_BYTE_START,
	ESCAPE_LINK_PATH,
	FIXTURE_FILES,
	fixtureFile,
	gitIn,
	PATH_INJECTION_INPUTS,
	readManifest,
	restoreFixtureRepo,
	sha256,
} from "../fixtures/repos/cases.ts";

/**
 * T04 · Q04 — exact bytes, unicode, CRLF vs LF, byte ranges, digests, stale refs,
 * missing blobs and unsafe paths.
 *
 * Layer: unit. These restore the two REAL git bundles and assert that commits, original
 * bytes and hashes survive restoration. That is a property of the fixtures, which is
 * what T04 owes. Application acceptance for Q04 stays NOT RUN until an analyzer exists
 * to point at these — see tests/boundary/qcases.registry.test.ts.
 */

let work: string;
let alpha: string;
let beta: string;
const manifest = readManifest();

beforeAll(() => {
	work = mkdtempSync(join(tmpdir(), "twh-q04-"));
	alpha = restoreFixtureRepo("alpha", join(work, "alpha"));
	beta = restoreFixtureRepo("beta", join(work, "beta"));
});

afterAll(() => {
	if (work) rmSync(work, { recursive: true, force: true });
});

describe("fixture bundles", () => {
	it("ships both bundles and a manifest", () => {
		expect(existsSync(bundlePath("alpha"))).toBe(true);
		expect(existsSync(bundlePath("beta"))).toBe(true);
		expect(Object.keys(manifest.repos).sort()).toEqual(["alpha", "beta"]);
	});

	it("restores to the exact commits the manifest pins", () => {
		expect(gitIn(alpha, ["rev-parse", "HEAD"])).toBe(
			manifest.repos.alpha.headCommit,
		);
		expect(gitIn(beta, ["rev-parse", "HEAD"])).toBe(
			manifest.repos.beta.headCommit,
		);
	});

	it("carries the superseded revision as a real commit, not an invented id", () => {
		const stale = manifest.repos.alpha.staleCommit;
		expect(stale).toBeTruthy();
		expect(gitIn(alpha, ["cat-file", "-t", String(stale)])).toBe("commit");
		expect(stale).not.toBe(manifest.repos.alpha.headCommit);
		expect(gitIn(alpha, ["rev-parse", "HEAD~1"])).toBe(stale);
	});

	it("restores blob ids identical to the manifest", () => {
		for (const [path, entry] of Object.entries(manifest.repos.alpha.files)) {
			expect(gitIn(alpha, ["rev-parse", `HEAD:${path}`]), path).toBe(
				entry.blob,
			);
		}
		for (const [path, entry] of Object.entries(manifest.repos.beta.files)) {
			expect(gitIn(beta, ["rev-parse", `HEAD:${path}`]), path).toBe(entry.blob);
		}
	});

	it("keeps the two repos independent", () => {
		expect(manifest.repos.alpha.headCommit).not.toBe(
			manifest.repos.beta.headCommit,
		);
		expect(readFileSync(join(beta, "lib/beta.ts"), "utf8")).toContain(
			"SYNTHETIC_BETA_MARKER_0001",
		);
		expect(existsSync(join(beta, "src/alpha.ts"))).toBe(false);
	});
});

describe("Q04 exact bytes after restoration", () => {
	function rootFor(repo: "alpha" | "beta"): string {
		return repo === "alpha" ? alpha : beta;
	}

	it("returns the original bytes and digest for every fixture file", () => {
		for (const f of FIXTURE_FILES) {
			const onDisk = readFileSync(join(rootFor(f.repo), f.path));
			expect(onDisk.byteLength, f.path).toBe(f.byteLength);
			expect(sha256(onDisk), f.path).toBe(f.sha256);
		}
	});

	it("preserves CRLF and LF as genuinely different bytes", () => {
		const lf = readFileSync(join(alpha, "src/unicode-lf.txt"));
		const crlf = readFileSync(join(alpha, "src/unicode-crlf.txt"));
		expect(crlf.byteLength).toBeGreaterThan(lf.byteLength);
		expect(sha256(crlf)).not.toBe(sha256(lf));
		// `.gitattributes` marks these -text in both this repo and the fixture repo. If
		// either policy were lost, git would normalise on checkout and this would fail.
		expect(crlf.includes(Buffer.from("\r\n"))).toBe(true);
		expect(lf.includes(Buffer.from("\r\n"))).toBe(false);
	});

	it("serves a byte range exactly, including one that splits a multi-byte character", () => {
		for (const c of BYTE_CASES) {
			if (c.expected.kind !== "bytes" || c.range === null) continue;
			const full = readFileSync(join(rootFor(c.repo), c.path));
			const window = full.subarray(c.range.startByte, c.range.endByte);
			expect(window.byteLength, c.id).toBe(c.expected.byteLength);
			expect(sha256(window), c.id).toBe(c.expected.sha256);
		}
	});

	it("addresses by byte, not by line: the same range differs across LF and CRLF", () => {
		const lfCase = BYTE_CASES.find((c) => c.id === "window-crossing-multibyte");
		const crlfCase = BYTE_CASES.find((c) => c.id === "window-crlf-variant");
		expect(lfCase?.expected.kind).toBe("bytes");
		expect(crlfCase?.expected.kind).toBe("bytes");
		if (
			lfCase?.expected.kind !== "bytes" ||
			crlfCase?.expected.kind !== "bytes"
		)
			return;
		expect(crlfCase.expected.sha256).not.toBe(lfCase.expected.sha256);
	});

	it("makes a window a strict subset of the whole file", () => {
		const windowCase = BYTE_CASES.find((c) => c.id === "exact-byte-window");
		const whole = fixtureFile("src/alpha.ts");
		expect(windowCase?.expected.kind).toBe("bytes");
		if (windowCase?.expected.kind !== "bytes") return;
		expect(windowCase.expected.byteLength).toBeGreaterThan(0);
		expect(windowCase.expected.byteLength).toBeLessThan(whole.byteLength);
		expect(windowCase.expected.sha256).not.toBe(whole.sha256);
	});

	it("splits a multi-byte character rather than silently rounding to a boundary", () => {
		const full = readFileSync(join(alpha, "src/unicode-lf.txt"));
		const end = EMOJI_BYTE_START + 2;
		const window = full.subarray(0, end);

		// The window ends two bytes into a four-byte character.
		expect(end).toBeGreaterThan(EMOJI_BYTE_START);
		expect(end).toBeLessThan(EMOJI_BYTE_START + 4);

		// Round-tripping through a UTF-8 string replaces the partial character, changing
		// the bytes. An implementation that decodes before slicing fails here.
		expect(Buffer.from(window.toString("utf8"), "utf8").equals(window)).toBe(
			false,
		);

		// The declared expectation must match the bytes actually on disk.
		const declared = BYTE_CASES.find((c) => c.id === "window-splits-multibyte");
		expect(declared?.expected.kind).toBe("bytes");
		if (declared?.expected.kind !== "bytes") return;
		expect(sha256(window)).toBe(declared.expected.sha256);
	});
});

describe("Q04 unavailable and rejected references", () => {
	it("treats the stale revision as a different revision, not current HEAD", () => {
		const stale = String(manifest.repos.alpha.staleCommit);
		const atStale = gitIn(alpha, ["show", `${stale}:src/alpha.ts`]);
		const atHead = gitIn(alpha, ["show", "HEAD:src/alpha.ts"]);
		expect(atStale).toContain("SYNTHETIC_ALPHA_MARKER_V1");
		expect(atHead).toContain("SYNTHETIC_ALPHA_MARKER_0001");
		expect(atStale).not.toBe(atHead);
	});

	it("has no blob at the missing-blob path", () => {
		const missing = BYTE_CASES.find((c) => c.id === "missing-blob");
		expect(missing?.expected).toEqual({
			kind: "unavailable",
			reason: "missing_blob",
		});
		expect(existsSync(join(alpha, String(missing?.path)))).toBe(false);
		expect(() =>
			gitIn(alpha, ["rev-parse", `HEAD:${missing?.path}`]),
		).toThrow();
	});

	it("carries a real symlink whose target escapes the repository root", () => {
		const link = join(alpha, ESCAPE_LINK_PATH);
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		expect(readlinkSync(link)).toBe(
			manifest.repos.alpha.symlinks?.[ESCAPE_LINK_PATH],
		);

		const resolved = resolve(join(alpha, "src"), readlinkSync(link));
		expect(
			isInside(resolve(alpha), resolved),
			`${resolved} should be outside ${alpha}`,
		).toBe(false);

		// Git stores it as a link, so a naive tree walk sees a file and follows it.
		expect(gitIn(alpha, ["cat-file", "-t", `HEAD:${ESCAPE_LINK_PATH}`])).toBe(
			"blob",
		);
		expect(gitIn(alpha, ["ls-tree", "HEAD", ESCAPE_LINK_PATH])).toMatch(
			/^120000 /,
		);
	});

	it("declares unavailable and rejected as outcomes distinct from bytes", () => {
		const kinds = new Map(BYTE_CASES.map((c) => [c.id, c.expected.kind]));
		expect(kinds.get("stale-branch-ref")).toBe("unavailable");
		expect(kinds.get("missing-blob")).toBe("unavailable");
		expect(kinds.get("symlink-escape")).toBe("rejected");
	});
});

/**
 * Segment-aware containment check.
 *
 * `relative(root, p).startsWith('..')` is NOT this test. On POSIX the input
 * `..\..\windows\win.ini` is a single filename segment, so `relative()` returns the
 * literal string `..\..\windows\win.ini`, which begins with ".." while resolving
 * comfortably inside the root. A string-prefix containment check reports "escape" for
 * a path that never escapes — and, worse, the same class of check reports "contained"
 * for a sibling directory like `/srv/repo-evil` next to `/srv/repo`. The analyzer in
 * T07 must compare path SEGMENTS.
 */
function isInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	if (rel === "") return true;
	if (isAbsolute(rel)) return false;
	return rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * A real NUL byte, built rather than written literally. A raw 0x00 in a source file
 * makes file(1) report "data" and makes grep, and some scanners, treat the file as
 * binary and skip it - which reads exactly like a clean result. Never embed one.
 */
const NUL_BYTE = String.fromCharCode(0);

describe("Q04 path injection inputs", () => {
	it("rejects string-prefix containment checking, which is wrong in both directions", () => {
		const root = resolve(alpha);
		// False escape: a path that stays inside but whose relative form starts with "..".
		const inertBackslash = resolve(root, "..\\..\\windows\\win.ini");
		expect(relative(root, inertBackslash).startsWith("..")).toBe(true);
		expect(isInside(root, inertBackslash)).toBe(true);
		// False containment: a sibling directory sharing the root's name prefix.
		const sibling = `${root}-evil`;
		expect(sibling.startsWith(root)).toBe(true);
		expect(isInside(root, sibling)).toBe(false);
	});

	it("offers inputs that all escape or malform the snapshot path", () => {
		expect(PATH_INJECTION_INPUTS.length).toBeGreaterThanOrEqual(8);
		for (const input of PATH_INJECTION_INPUTS) {
			const hostile =
				input.path.includes("..") ||
				input.path.includes("%2e") ||
				input.path.startsWith("/") ||
				/^[A-Za-z]:/.test(input.path) ||
				input.path.includes(NUL_BYTE) ||
				input.path.startsWith(".git");
			expect(hostile, `${input.id} should be hostile`).toBe(true);
		}
	});

	it("resolves the POSIX traversal inputs outside the restored root", () => {
		const root = resolve(alpha);
		for (const id of ["dotdot-relative", "dotdot-nested", "absolute-posix"]) {
			const input = PATH_INJECTION_INPUTS.find((i) => i.id === id);
			const resolved = resolve(root, String(input?.path));
			expect(isInside(root, resolved), id).toBe(false);
		}
	});

	it("records which inputs path.resolve() does NOT neutralise the danger of", () => {
		// Finding worth keeping: on a POSIX host `C:\Windows\win.ini` and `..\..\win.ini`
		// are not absolute and contain no POSIX separator, so `resolve()` keeps them
		// INSIDE the root and they look harmless. They are still hostile on a Windows
		// host. A validator that trusts `resolve()` alone therefore passes them through.
		// The analyzer in T07 must reject these explicitly, not by containment checking.
		const root = resolve(alpha);
		for (const id of ["absolute-windows", "backslash-traversal"]) {
			const input = PATH_INJECTION_INPUTS.find((i) => i.id === id);
			const resolved = resolve(root, String(input?.path));
			expect(
				isInside(root, resolved),
				`${id} is inert under POSIX resolve`,
			).toBe(true);
			expect(String(input?.path)).toContain("\\");
		}
	});

	it("flags the inputs that only an explicit validator can reject", () => {
		// A NUL byte makes fs calls throw rather than escape; percent-encoding is inert
		// until something decodes it; `.git/` stays inside the root by construction.
		// None of these are caught by a containment check either.
		const root = resolve(alpha);
		for (const id of ["null-byte", "url-encoded-dotdot", "git-internal"]) {
			const input = PATH_INJECTION_INPUTS.find((i) => i.id === id);
			expect(input, id).toBeDefined();
			const resolved = resolve(root, String(input?.path));
			expect(isInside(root, resolved), `${id} stays inside the root`).toBe(
				true,
			);
		}
	});

	it("classifies every injection input exactly once", () => {
		const classified = new Set([
			"dotdot-relative",
			"dotdot-nested",
			"absolute-posix",
			"absolute-windows",
			"backslash-traversal",
			"null-byte",
			"url-encoded-dotdot",
			"git-internal",
		]);
		expect(new Set(PATH_INJECTION_INPUTS.map((i) => i.id))).toEqual(classified);
	});

	it("has unique case ids across both tables", () => {
		const ids = [
			...BYTE_CASES.map((c) => c.id),
			...PATH_INJECTION_INPUTS.map((c) => c.id),
		];
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("T05 real Git reader against the independent Q04 fixtures", () => {
	let snapshots: Record<"alpha" | "beta", GitSnapshot>;
	beforeAll(async () => {
		snapshots = {
			alpha: await openSnapshot({
				repositoryId: "alpha",
				bundlePath: bundlePath("alpha"),
			}),
			beta: await openSnapshot({
				repositoryId: "beta",
				bundlePath: bundlePath("beta"),
			}),
		};
	});
	afterAll(async () => {
		if (snapshots)
			await Promise.all(
				Object.values(snapshots).map((snapshot) => snapshot.close()),
			);
	});

	it("pins both real commits and their root tree objects", () => {
		for (const repo of ["alpha", "beta"] as const) {
			const snapshot = snapshots[repo];
			expect(snapshot.summary.commit).toBe(manifest.repos[repo].headCommit);
			expect(snapshot.summary.rootTreeId).toBe(
				gitIn(repo === "alpha" ? alpha : beta, ["rev-parse", "HEAD^{tree}"]),
			);
			expect(snapshot.summary.coverage).toBe("not_indexed");
		}
	});

	it("browses immediate children using entry IDs, without flattening descendants", () => {
		const snapshot = snapshots.alpha;
		const page = browseSnapshot(snapshot, {
			snapshotId: snapshot.summary.snapshotId,
		});
		expect(validEnvelope(page)).toBe(true);
		expect(page.entries.every((entry) => entry.parentEntryId === null)).toBe(
			true,
		);
		const src = snapshot.entries.find((entry) => entry.displayPath === "src");
		expect(src).toBeDefined();
		const children = browseSnapshot(snapshot, {
			snapshotId: snapshot.summary.snapshotId,
			parentEntryId: src?.entryId,
		});
		expect(children.entries.map((entry) => entry.name)).toEqual([
			"alpha.ts",
			"escape-link.txt",
			"unicode-crlf.txt",
			"unicode-lf.txt",
		]);
		expect(children.nextCursor).toBeNull();
	});

	it("returns original bytes, blob identities and digests for all fixture files", async () => {
		for (const fixture of FIXTURE_FILES) {
			const snapshot = snapshots[fixture.repo];
			const entry = snapshot.entries.find(
				(item) => item.displayPath === fixture.path,
			);
			expect(entry).toBeDefined();
			const evidence = await readSource(snapshot, {
				snapshotId: snapshot.summary.snapshotId,
				entryId: String(entry?.entryId),
			});
			expect(validEvidence(evidence)).toBe(true);
			expect(Buffer.from(evidence.content)).toEqual(
				Buffer.from(fixture.content),
			);
			expect(`sha256:${evidence.ref.digest}`).toBe(fixture.sha256);
			expect(evidence.ref.blobId).toBe(
				manifest.repos[fixture.repo].files[fixture.path].blob,
			);
			expect(evidence.ref.byteRange).toEqual({
				start: 0,
				end: fixture.byteLength,
			});
		}
	});

	it("serves Q04 byte windows exactly or rejects split UTF-8 without replacement", async () => {
		for (const fixture of BYTE_CASES) {
			if (fixture.expected.kind !== "bytes" || !fixture.range) continue;
			const snapshot = snapshots[fixture.repo];
			const entry = snapshot.entries.find(
				(item) => item.displayPath === fixture.path,
			);
			const range = {
				start: fixture.range.startByte,
				end: fixture.range.endByte,
			};
			const original = Buffer.from(fixtureFile(fixture.path).content).subarray(
				range.start,
				range.end,
			);
			const pending = readSource(snapshot, {
				snapshotId: snapshot.summary.snapshotId,
				entryId: String(entry?.entryId),
				byteRange: range,
			});
			if (!Buffer.from(original.toString("utf8")).equals(original)) {
				await expect(pending).rejects.toMatchObject({
					code: "invalid_request",
				});
			} else {
				const evidence = await pending;
				expect(Buffer.from(evidence.content)).toEqual(original);
				expect(`sha256:${evidence.ref.digest}`).toBe(fixture.expected.sha256);
			}
		}
	});

	it("preserves CRLF in line windows and labels an explicitly capped response", async () => {
		const snapshot = snapshots.alpha;
		const entry = snapshot.entries.find(
			(item) => item.displayPath === "src/unicode-crlf.txt",
		);
		const request = {
			snapshotId: snapshot.summary.snapshotId,
			entryId: String(entry?.entryId),
		};
		const evidence = await readSource(snapshot, {
			...request,
			lineRange: { start: 1, end: 2 },
		});
		expect(evidence.content).toBe(
			`${fixtureFile("src/unicode-crlf.txt")
				.content.split("\r\n")
				.slice(0, 2)
				.join("\r\n")}\r\n`,
		);
		const capped = await readSource(snapshot, { ...request, maxBytes: 10 });
		expect(capped.rangeAdjusted).toBe(true);
		expect(capped.ref.byteRange).toEqual({ start: 0, end: 10 });
		expect(capped.nextRange).toEqual({ start: 10, end: capped.blobSize });
		expect(capped.content).toBe("// SYNTHET");
	});

	it("rejects inverted, ambiguous, out-of-bounds, foreign and path-shaped requests", async () => {
		const snapshot = snapshots.alpha;
		const entry = snapshot.entries.find(
			(item) => item.displayPath === "src/alpha.ts",
		);
		const request = {
			snapshotId: snapshot.summary.snapshotId,
			entryId: String(entry?.entryId),
		};
		for (const override of [
			{ byteRange: { start: 9, end: 2 } },
			{ lineRange: { start: 3, end: 1 } },
			{ byteRange: { start: 0, end: 99999 } },
			{ lineRange: { start: 1, end: 99999 } },
			{ byteRange: { start: 0, end: 1 }, lineRange: { start: 1, end: 1 } },
		])
			await expect(
				readSource(snapshot, { ...request, ...override }),
			).rejects.toMatchObject({ code: "invalid_request" });
		for (const input of PATH_INJECTION_INPUTS) {
			await expect(
				readSource(snapshot, { ...request, entryId: input.path }),
			).rejects.toMatchObject({ code: "invalid_request" });
		}
		await expect(
			readSource(snapshot, {
				...request,
				snapshotId: snapshots.beta.summary.snapshotId,
			}),
		).rejects.toMatchObject({ code: "source_unavailable" });
		expect(() => assertObjectId("a".repeat(40), "sha256")).toThrow();
	});

	it("does not follow the fixture symlink or invent a missing source", async () => {
		const snapshot = snapshots.alpha;
		const link = snapshot.entries.find(
			(entry) => entry.displayPath === ESCAPE_LINK_PATH,
		);
		expect(link?.indexStatus).toBe("excluded");
		await expect(
			readSource(snapshot, {
				snapshotId: snapshot.summary.snapshotId,
				entryId: String(link?.entryId),
			}),
		).rejects.toMatchObject({ code: "unsupported" });
		await expect(
			readSource(snapshot, {
				snapshotId: snapshot.summary.snapshotId,
				entryId: "missing",
			}),
		).rejects.toMatchObject({ code: "source_unavailable" });
	});

	it("rejects forged cursors, revision expressions and unavailable object stores", async () => {
		const snapshot = snapshots.alpha;
		expect(() =>
			browseSnapshot(snapshot, {
				snapshotId: snapshot.summary.snapshotId,
				cursor: `100:${"a".repeat(64)}`,
			}),
		).toThrow();
		await expect(
			openSnapshot({
				repositoryId: "alpha",
				bundlePath: bundlePath("alpha"),
				ref: "HEAD~1",
			}),
		).rejects.toMatchObject({ code: "invalid_request" });
		const temporary = await openSnapshot({
			repositoryId: "alpha",
			bundlePath: bundlePath("alpha"),
		});
		const entry = temporary.entries.find((item) => item.kind === "blob");
		await temporary.close();
		await expect(
			readSource(temporary, {
				snapshotId: temporary.summary.snapshotId,
				entryId: String(entry?.entryId),
			}),
		).rejects.toMatchObject({ code: "source_unavailable" });
		expect(() =>
			browseSnapshot(temporary, { snapshotId: temporary.summary.snapshotId }),
		).toThrow();
	});
});
