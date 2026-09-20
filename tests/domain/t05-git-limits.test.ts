import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runGit } from "../../src/server/git/process";
import { readSource } from "../../src/server/git/read-blob";
import { type GitSnapshot, openSnapshot } from "../../src/server/git/snapshot";
import { browseSnapshot } from "../../src/server/git/tree";

// This is an operator-authored test repository. No ingested repository is modified.
let work: string;
let snapshot: GitSnapshot;
let bundle: string;
function git(args: string[]) {
	return execFileSync(
		"/usr/bin/git",
		["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
		{
			cwd: work,
			encoding: "utf8",
			env: {
				PATH: "/usr/bin:/bin",
				HOME: work,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_AUTHOR_NAME: "Synthetic",
				GIT_AUTHOR_EMAIL: "fixture@example.invalid",
				GIT_COMMITTER_NAME: "Synthetic",
				GIT_COMMITTER_EMAIL: "fixture@example.invalid",
			},
		},
	);
}

beforeAll(async () => {
	work = mkdtempSync(join(tmpdir(), "think-wide-limits-test-"));
	git(["init", "--quiet", "--template=", "-b", "main"]);
	mkdirSync(join(work, "many"));
	mkdirSync(join(work, "other"));
	for (let i = 0; i < 105; i++) {
		writeFileSync(
			join(work, "many", `file-${String(i).padStart(3, "0")}.txt`),
			"synthetic\r\n",
		);
		writeFileSync(
			join(work, "other", `file-${String(i).padStart(3, "0")}.txt`),
			"other\n",
		);
	}
	writeFileSync(join(work, "bom.txt"), "\uFEFFexact BOM\r\n");
	writeFileSync(join(work, "\uFEFFname.txt"), "exact filename\n");
	writeFileSync(join(work, "large.txt"), Buffer.alloc(2 ** 20 + 1, 97));
	writeFileSync(join(work, "window.txt"), Buffer.alloc(20000, 97));
	writeFileSync(
		join(work, "pointer.txt"),
		`version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 42\n`,
	);
	writeFileSync(join(work, "binary.bin"), Buffer.from([0xff, 0xfe, 0, 1]));
	git(["add", "."]);
	git(["commit", "--quiet", "-m", "Synthetic bounded-read cases"]);
	bundle = join(work, "source.bundle");
	git(["bundle", "create", bundle, "--all"]);
	snapshot = await openSnapshot({ repositoryId: "limits", bundlePath: bundle });
});

afterAll(async () => {
	if (snapshot) await snapshot.close();
	if (work) rmSync(work, { recursive: true, force: true });
});

describe("T05 real Git limits and confinement", () => {
	it("enforces the subprocess output cap without returning a partial result", async () => {
		await expect(runGit(work, ["version"], 1)).rejects.toMatchObject({
			code: "limit_exceeded",
		});
	});

	it("rejects invalid operator identities and directories as bundles", async () => {
		await expect(
			openSnapshot({ repositoryId: "../invalid", bundlePath: bundle }),
		).rejects.toMatchObject({ code: "invalid_request" });
		await expect(
			openSnapshot({ repositoryId: "limits", bundlePath: work }),
		).rejects.toMatchObject({ code: "limit_exceeded" });
	});
	it("pages immediate children within item and response caps using scope-bound cursors", () => {
		const many = snapshot.entries.find((entry) => entry.name === "many");
		const other = snapshot.entries.find((entry) => entry.name === "other");
		const request = {
			snapshotId: snapshot.summary.snapshotId,
			parentEntryId: many?.entryId,
		};
		const first = browseSnapshot(snapshot, request);
		expect(first.entries.length).toBeGreaterThan(0);
		expect(first.entries.length).toBeLessThanOrEqual(100);
		expect(first.truncated).toEqual({ is: true, reason: "response_cap" });
		expect(first.nextCursor).toBeTruthy();
		const ids = first.entries.map((entry) => entry.entryId);
		let page = first;
		while (page.nextCursor) {
			expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
				16384,
			);
			page = browseSnapshot(snapshot, { ...request, cursor: page.nextCursor });
			ids.push(...page.entries.map((entry) => entry.entryId));
			if (ids.length > 105) throw new Error("Cursor repeated entries");
		}
		expect(new Set(ids).size).toBe(105);
		expect(page.truncated.is).toBe(false);
		expect(browseSnapshot(snapshot, request).nextCursor).toBe(first.nextCursor);
		expect(() =>
			browseSnapshot(snapshot, {
				...request,
				parentEntryId: other?.entryId,
				cursor: String(first.nextCursor),
			}),
		).toThrow();
	});

	it("does not strip a BOM from source bytes or a tree name", async () => {
		const entry = snapshot.entries.find((item) => item.name === "bom.txt");
		const evidence = await readSource(snapshot, {
			snapshotId: snapshot.summary.snapshotId,
			entryId: String(entry?.entryId),
		});
		expect(Buffer.from(evidence.content)).toEqual(
			Buffer.from("\uFEFFexact BOM\r\n"),
		);
		expect(
			snapshot.entries.some((item) => item.name === "\uFEFFname.txt"),
		).toBe(true);
	});

	it("reports oversized coverage and rejects large, binary and LFS content", async () => {
		expect(snapshot.coverage.byteLimited).toBe(true);
		for (const [name, code] of [
			["large.txt", "limit_exceeded"],
			["binary.bin", "invalid_request"],
			["pointer.txt", "unsupported"],
		]) {
			const entry = snapshot.entries.find((item) => item.name === name);
			await expect(
				readSource(snapshot, {
					snapshotId: snapshot.summary.snapshotId,
					entryId: String(entry?.entryId),
				}),
			).rejects.toMatchObject({ code });
		}
	});

	it("bounds serialized evidence as well as raw bytes, with explicit continuation", async () => {
		const entry = snapshot.entries.find((item) => item.name === "window.txt");
		const request = {
			snapshotId: snapshot.summary.snapshotId,
			entryId: String(entry?.entryId),
		};
		await expect(readSource(snapshot, request)).rejects.toMatchObject({
			code: "limit_exceeded",
		});
		const evidence = await readSource(snapshot, { ...request, maxBytes: 1024 });
		expect(evidence.content).toBe("a".repeat(1024));
		expect(evidence.nextRange).toEqual({ start: 1024, end: 20000 });
		expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(
			16384,
		);
	});

	it("ignores inherited Git configuration, object-store paths and command hooks", async () => {
		const config = join(work, "hostile.config");
		const marker = join(work, "hook-ran");
		writeFileSync(config, "this is intentionally invalid Git configuration\n");
		vi.stubEnv("GIT_CONFIG_GLOBAL", config);
		vi.stubEnv("GIT_DIR", "/does-not-exist");
		vi.stubEnv("GIT_OBJECT_DIRECTORY", "/does-not-exist");
		vi.stubEnv("GIT_CONFIG_COUNT", "1");
		vi.stubEnv("GIT_CONFIG_KEY_0", "core.fsmonitor");
		vi.stubEnv("GIT_CONFIG_VALUE_0", `touch ${marker}`);
		let clean: GitSnapshot | undefined;
		try {
			clean = await openSnapshot({
				repositoryId: "limits",
				bundlePath: bundle,
			});
			expect(clean.summary.commit).toBe(snapshot.summary.commit);
			expect(existsSync(marker)).toBe(false);
		} finally {
			vi.unstubAllEnvs();
			await clean?.close();
		}
	});

	it("pins imported objects even when the operator's bundle disappears", async () => {
		const entry = snapshot.entries.find((item) => item.name === "bom.txt");
		const copy = join(work, "evict.bundle");
		git(["bundle", "create", copy, "--all"]);
		const pinned = await openSnapshot({
			repositoryId: "limits",
			bundlePath: copy,
		});
		try {
			rmSync(copy);
			const evidence = await readSource(pinned, {
				snapshotId: pinned.summary.snapshotId,
				entryId: String(entry?.entryId),
			});
			expect(evidence.content).toBe("\uFEFFexact BOM\r\n");
		} finally {
			await pinned.close();
		}
	});
});
