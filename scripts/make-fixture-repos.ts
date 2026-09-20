/**
 * T04 — reproducible creation of the two synthetic fixture repos (issue #4).
 *
 *   bun run scripts/make-fixture-repos.ts
 *
 * Builds two small REAL git repositories from the content declared in
 * tests/fixtures/repos/cases.ts, bundles each with `git bundle`, and writes
 * tests/fixtures/repos/manifest.json recording the commit SHAs, blob SHAs and
 * content digests.
 *
 * "Reproducible" here means the COMMIT AND BLOB SHAs are stable: author and committer
 * identity and both timestamps are pinned, so a rerun on another machine produces the
 * same object IDs. The .bundle files themselves are packfiles and their exact bytes can
 * differ between git versions or zlib settings — that is why the manifest pins object
 * IDs rather than a hash of the bundle file. The test asserts a restored bundle
 * reproduces the manifest, which is the property that actually matters.
 *
 * Everything written here is clearly synthetic and operator-authored.
 */

import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RepoManifest, RepoName } from "../tests/fixtures/repos/cases.ts";
import {
	ALPHA_TS,
	ALPHA_TS_V1,
	BETA_TS,
	bundlePath,
	ESCAPE_LINK_PATH,
	ESCAPE_LINK_TARGET,
	FIXTURE_FILES,
	manifestPath,
	sha256,
	UNICODE_CRLF,
	UNICODE_LF,
} from "../tests/fixtures/repos/cases.ts";

const FIXED_DATE = "2026-01-01T00:00:00+00:00";
const IDENTITY = {
	GIT_AUTHOR_NAME: "Think-wide Fixture Bot",
	GIT_AUTHOR_EMAIL: "fixtures@think-wide.invalid",
	GIT_AUTHOR_DATE: FIXED_DATE,
	GIT_COMMITTER_NAME: "Think-wide Fixture Bot",
	GIT_COMMITTER_EMAIL: "fixtures@think-wide.invalid",
	GIT_COMMITTER_DATE: FIXED_DATE,
};

const BRANCH = "main";

function git(cwd: string, args: readonly string[]): string {
	return execFileSync("git", [...args], {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
		env: { ...process.env, ...IDENTITY },
	}).trim();
}

function write(root: string, path: string, content: string): void {
	const full = join(root, path);
	mkdirSync(dirname(full), { recursive: true });
	// Explicit Buffer: never let a platform default rewrite these bytes.
	writeFileSync(full, Buffer.from(content, "utf8"));
}

/** Keeps git from normalising line endings inside the fixture repo itself. */
const REPO_GITATTRIBUTES = "* -text\n";

function initRepo(root: string): void {
	mkdirSync(root, { recursive: true });
	// --object-format is explicit: a host with init.defaultObjectFormat=sha256 would
	// otherwise produce object IDs that do not match the 40-character SHA-1s pinned in
	// manifest.json, quietly breaking the reproducibility this script exists to provide.
	git(root, [
		"init",
		"--quiet",
		"--object-format=sha1",
		`--initial-branch=${BRANCH}`,
	]);
	// An inherited core.hooksPath (husky, lefthook) would run the operator's own hooks
	// inside the fixture repo, where a pre-commit or commit-msg hook can alter the tree
	// or message and change the commit SHA. Point it at an empty directory.
	const hooks = join(root, ".git", "twh-empty-hooks");
	mkdirSync(hooks, { recursive: true });
	git(root, ["config", "core.hooksPath", hooks]);
	git(root, ["config", "user.name", IDENTITY.GIT_AUTHOR_NAME]);
	git(root, ["config", "user.email", IDENTITY.GIT_AUTHOR_EMAIL]);
	git(root, ["config", "core.autocrlf", "false"]);
	git(root, ["config", "core.symlinks", "true"]);
	git(root, ["config", "commit.gpgsign", "false"]);
}

function commit(root: string, message: string): string {
	git(root, ["add", "--all"]);
	git(root, ["commit", "--quiet", "--no-gpg-sign", "-m", message]);
	return git(root, ["rev-parse", "HEAD"]);
}

function buildAlpha(root: string): {
	head: string;
	stale: string;
	symlinkSupported: boolean;
} {
	initRepo(root);

	// Commit 1 — superseded revision. Exists so 'stale ref' is a real git object, not a
	// made-up identifier.
	write(root, ".gitattributes", REPO_GITATTRIBUTES);
	write(
		root,
		"README.md",
		"# SYNTHETIC FIXTURE REPO: alpha\n\nOperator-authored. Not real source.\n",
	);
	write(root, "src/alpha.ts", ALPHA_TS_V1);
	const stale = commit(root, "alpha: first synthetic revision");

	// Commit 2 — current revision.
	write(root, "src/alpha.ts", ALPHA_TS);
	write(root, "src/unicode-lf.txt", UNICODE_LF);
	write(root, "src/unicode-crlf.txt", UNICODE_CRLF);

	let symlinkSupported = true;
	try {
		symlinkSync(ESCAPE_LINK_TARGET, join(root, ESCAPE_LINK_PATH));
	} catch {
		// A host without symlink permission cannot carry this case. NOT ASSESSED, not clean.
		symlinkSupported = false;
	}

	const head = commit(
		root,
		"alpha: current synthetic revision with unicode and escape link",
	);
	return { head, stale, symlinkSupported };
}

function buildBeta(root: string): { head: string } {
	initRepo(root);
	write(root, ".gitattributes", REPO_GITATTRIBUTES);
	write(
		root,
		"README.md",
		"# SYNTHETIC FIXTURE REPO: beta\n\nOperator-authored. Not real source.\n",
	);
	write(root, "lib/beta.ts", BETA_TS);
	return { head: commit(root, "beta: synthetic revision") };
}

function filesFor(
	repo: RepoName,
	root: string,
): RepoManifest["repos"][RepoName]["files"] {
	const entries = FIXTURE_FILES.filter((f) => f.repo === repo).map((f) => [
		f.path,
		{
			blob: git(root, ["rev-parse", `HEAD:${f.path}`]),
			sha256: f.sha256,
			byteLength: f.byteLength,
		},
	]);
	return Object.fromEntries(entries);
}

function main(): void {
	const work = mkdtempSync(join(tmpdir(), "twh-fixture-build-"));
	try {
		const alphaRoot = join(work, "alpha");
		const betaRoot = join(work, "beta");
		const alpha = buildAlpha(alphaRoot);
		const beta = buildBeta(betaRoot);

		if (!alpha.symlinkSupported) {
			throw new Error(
				"symlink creation failed on this host; the Q04 path-escape case cannot be built. Run inside WSL2, not /mnt/c.",
			);
		}

		for (const [repo, root] of [
			["alpha", alphaRoot],
			["beta", betaRoot],
		] as const) {
			const out = bundlePath(repo);
			rmSync(out, { force: true });
			git(root, ["bundle", "create", out, "--all"]);
		}

		const manifest: RepoManifest = {
			generator: "scripts/make-fixture-repos.ts",
			note: "Synthetic operator-authored fixtures. Commit and blob IDs are pinned; bundle bytes are not.",
			repos: {
				alpha: {
					bundle: "alpha.bundle",
					headCommit: alpha.head,
					staleCommit: alpha.stale,
					branch: BRANCH,
					files: filesFor("alpha", alphaRoot),
					symlinks: { [ESCAPE_LINK_PATH]: ESCAPE_LINK_TARGET },
				},
				beta: {
					bundle: "beta.bundle",
					headCommit: beta.head,
					staleCommit: null,
					branch: BRANCH,
					files: filesFor("beta", betaRoot),
				},
			},
		};

		writeFileSync(
			manifestPath(),
			`${JSON.stringify(manifest, null, "\t")}\n`,
			"utf8",
		);

		console.log(`alpha head=${alpha.head} stale=${alpha.stale}`);
		console.log(`beta  head=${beta.head}`);
		console.log(`manifest digest ${sha256(JSON.stringify(manifest))}`);
		console.log(
			"wrote tests/fixtures/repos/{alpha,beta}.bundle and manifest.json",
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

main();
