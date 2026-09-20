import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Coverage,
	SnapshotEntry,
	SnapshotSummary,
} from "../../../generated/types";
import {
	SnapshotEntry as validEntry,
	Project as validProject,
} from "../../../generated/validators.js";
import { assertObjectId, GitSourceError, runGit } from "./process";

export const MAX_BLOB_BYTES = 2 ** 20;
const MAX_BUNDLE_BYTES = 32 * 2 ** 20;
const MAX_ENTRIES = 5000;

export type SnapshotSelection = {
	// Operator configuration, never an HTTP/MCP request parameter.
	bundlePath: string;
	repositoryId: string;
	ref?: string;
};

export class GitSnapshot {
	readonly cursorSecret = randomBytes(32);
	readonly entries: readonly Readonly<SnapshotEntry>[];
	readonly summary: Readonly<SnapshotSummary>;
	readonly coverage: Readonly<Coverage>;
	#byId: Map<string, Readonly<SnapshotEntry>>;
	#closed = false;

	constructor(
		private readonly directory: string,
		readonly repositoryId: string,
		summary: SnapshotSummary,
		entries: SnapshotEntry[],
		excluded: number,
	) {
		this.summary = Object.freeze(summary);
		this.coverage = Object.freeze({
			status: summary.coverage,
			notIndexed: entries.filter(
				(entry) => entry.kind === "blob" && entry.indexStatus === "not_indexed",
			).length,
			excluded:
				excluded +
				entries.filter((entry) => entry.indexStatus === "excluded").length,
			byteLimited: entries.some((entry) => entry.indexStatus === "too_large"),
		});
		this.entries = Object.freeze(entries.map((entry) => Object.freeze(entry)));
		this.#byId = new Map(this.entries.map((entry) => [entry.entryId, entry]));
	}

	entry(id: string) {
		this.assertOpen();
		const entry = this.#byId.get(id);
		if (!entry) {
			throw new GitSourceError(
				"source_unavailable",
				"Source entry is unavailable",
			);
		}
		return entry;
	}

	assertOpen() {
		if (this.#closed) {
			throw new GitSourceError(
				"source_unavailable",
				"Snapshot is no longer available",
			);
		}
	}

	async blob(entryId: string) {
		const entry = this.entry(entryId);
		if (entry.kind !== "blob") {
			throw new GitSourceError(
				"unsupported",
				"Only regular Git blobs can be read",
			);
		}
		if (entry.size === undefined || entry.size > MAX_BLOB_BYTES) {
			throw new GitSourceError(
				"limit_exceeded",
				"Blob exceeds the 1 MiB read limit",
			);
		}
		assertObjectId(entry.objectId, this.summary.hashAlgorithm);
		const bytes = await runGit(
			this.directory,
			["cat-file", "blob", entry.objectId],
			MAX_BLOB_BYTES,
		);
		const objectId = createHash(this.summary.hashAlgorithm)
			.update(`blob ${bytes.length}\0`)
			.update(bytes)
			.digest("hex");
		if (bytes.length !== entry.size || objectId !== entry.objectId) {
			throw new GitSourceError(
				"source_unavailable",
				"Blob integrity check failed",
			);
		}
		return bytes;
	}

	async close() {
		this.#closed = true;
		await rm(this.directory, { recursive: true, force: true });
	}
}

function safePath(path: string) {
	return (
		path.length <= 4096 &&
		!/[\\:%]/.test(path) &&
		![...path].some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) &&
		path
			.split("/")
			.every(
				(part) =>
					part &&
					part !== "." &&
					part !== ".." &&
					part.toLowerCase() !== ".git",
			)
	);
}

function indexTree(
	raw: Buffer,
	snapshotId: string,
	algorithm: "sha1" | "sha256",
) {
	const entries: SnapshotEntry[] = [];
	let excluded = 0;
	const idFor = (path: string) =>
		createHash("sha256").update(`${snapshotId}\0${path}`).digest("hex");
	const records = raw.toString("binary").split("\0").filter(Boolean);
	if (records.length > MAX_ENTRIES) {
		throw new GitSourceError(
			"limit_exceeded",
			"Snapshot exceeds 5000 tree entries",
		);
	}
	for (const record of records) {
		const separator = record.indexOf("\t");
		const metadata = record.slice(0, separator).trim().split(/\s+/);
		let path: string;
		try {
			path = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				Buffer.from(record.slice(separator + 1), "binary"),
			);
		} catch {
			excluded++;
			continue;
		}
		if (separator < 0 || metadata.length !== 4 || !safePath(path)) {
			excluded++;
			continue;
		}
		const [mode, type, objectId, size] = metadata;
		assertObjectId(objectId, algorithm);
		const kind =
			mode === "120000"
				? "symlink"
				: mode === "160000"
					? "submodule"
					: type === "tree"
						? "tree"
						: type === "blob" && ["100644", "100755"].includes(mode)
							? "blob"
							: "unsupported";
		const parent = path.includes("/")
			? path.slice(0, path.lastIndexOf("/"))
			: null;
		const entry: SnapshotEntry = {
			entryId: idFor(path),
			snapshotId,
			parentEntryId: parent === null ? null : idFor(parent),
			name: path.slice(path.lastIndexOf("/") + 1),
			displayPath: path,
			kind,
			mode,
			objectId,
			...(size !== "-" ? { size: Number(size) } : {}),
			indexStatus:
				kind === "blob"
					? Number(size) > MAX_BLOB_BYTES
						? "too_large"
						: "not_indexed"
					: kind === "tree"
						? "not_indexed"
						: "excluded",
		};
		if (!validEntry(entry)) {
			excluded++;
			continue;
		}
		entries.push(entry);
	}
	// A dropped parent must not leave unbrowseable children masquerading as indexed.
	const ids = new Set<string>();
	const reachable = entries.filter((entry) => {
		if (entry.parentEntryId !== null && !ids.has(entry.parentEntryId)) {
			return false;
		}
		ids.add(entry.entryId);
		return true;
	});
	return {
		entries: reachable,
		excluded: excluded + entries.length - reachable.length,
	};
}

/** Import only Git objects into an empty application-owned bare directory. Bundle
 * refs are read once; target config, worktrees, hooks, filters and submodules never run.
 * Authorization belongs to the caller's operation boundary, not this low-level reader.
 */
export async function openSnapshot(
	selection: SnapshotSelection,
): Promise<GitSnapshot> {
	if (
		!validProject({
			repositoryId: selection.repositoryId,
			displayName: selection.repositoryId,
			provider: "local-git",
			syncStatus: "ready",
			snapshots: [],
		})
	) {
		throw new GitSourceError("invalid_request", "Invalid repository identity");
	}
	const selectedRef = selection.ref ?? "HEAD";
	if (
		!/^(HEAD|refs\/(heads|tags)\/[A-Za-z0-9_./-]+)$/.test(selectedRef) ||
		selectedRef.includes("..") ||
		selectedRef.length > 256
	) {
		throw new GitSourceError(
			"invalid_request",
			"Select an advertised branch, tag or HEAD",
		);
	}
	const directory = await mkdtemp(join(tmpdir(), "think-wide-objects-"));
	try {
		const file = await open(
			selection.bundlePath,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		let bundle: Buffer;
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) {
				throw new GitSourceError(
					"limit_exceeded",
					"Select a regular bundle of at most 32 MiB",
				);
			}
			bundle = Buffer.alloc(stat.size + 1);
			let offset = 0;
			while (offset < bundle.length) {
				const { bytesRead } = await file.read(
					bundle,
					offset,
					bundle.length - offset,
					offset,
				);
				if (!bytesRead) {
					break;
				}
				offset += bytesRead;
			}
			if (offset !== stat.size) {
				throw new GitSourceError(
					"source_unavailable",
					"Bundle changed during import",
				);
			}
			bundle = bundle.subarray(0, offset);
		} finally {
			await file.close();
		}
		const headerEnd = bundle.indexOf("\n\n");
		if (headerEnd < 0 || headerEnd > 65536) {
			throw new GitSourceError("invalid_request", "Invalid bundle header");
		}
		const header = bundle.subarray(0, headerEnd).toString("utf8");
		const algorithm = header.includes("\n@object-format=sha256")
			? "sha256"
			: "sha1";
		await writeFile(join(directory, "source.bundle"), bundle, { mode: 0o600 });
		await runGit(directory, [
			"init",
			"--bare",
			"--template=",
			`--object-format=${algorithm}`,
			".",
		]);
		await runGit(directory, ["bundle", "verify", "source.bundle"]);
		const refs = (
			await runGit(directory, ["bundle", "unbundle", "source.bundle"])
		).toString("utf8");
		const line = refs
			.split("\n")
			.find((value) => value.slice(value.indexOf(" ") + 1) === selectedRef);
		if (!line) {
			throw new GitSourceError(
				"source_unavailable",
				"Selected reference is not in the bundle",
			);
		}
		const advertisedId = line.split(" ")[0];
		assertObjectId(advertisedId, algorithm);
		const commit = (
			await runGit(directory, [
				"rev-parse",
				"--verify",
				`${advertisedId}^{commit}`,
			])
		)
			.toString("utf8")
			.trim();
		const rootTreeId = (
			await runGit(directory, ["rev-parse", "--verify", `${commit}^{tree}`])
		)
			.toString("utf8")
			.trim();
		assertObjectId(commit, algorithm);
		assertObjectId(rootTreeId, algorithm);
		const snapshotId = createHash("sha256")
			.update(`${selection.repositoryId}\0${algorithm}\0${commit}`)
			.digest("hex");
		const tree = await runGit(directory, [
			"ls-tree",
			"-r",
			"-t",
			"-l",
			"-z",
			rootTreeId,
		]);
		const { entries, excluded } = indexTree(tree, snapshotId, algorithm);
		return new GitSnapshot(
			directory,
			selection.repositoryId,
			{
				snapshotId,
				commit,
				hashAlgorithm: algorithm,
				rootTreeId,
				indexedAt: Date.now(),
				resolvedFromRef: selectedRef,
				coverage: "not_indexed",
			},
			entries,
			excluded,
		);
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		if (error instanceof GitSourceError) {
			throw error;
		}
		throw new GitSourceError(
			"source_unavailable",
			"Selected Git bundle is unavailable",
		);
	}
}
