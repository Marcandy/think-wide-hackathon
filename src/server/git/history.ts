import { createHmac, timingSafeEqual } from "node:crypto";
import type {
	CommitRecord,
	ReadHistoryRequest,
	ResultEnvelope,
} from "../../../generated/types";
import {
	CommitRecord as validRecord,
	ReadHistoryRequest as validRequest,
} from "../../../generated/validators.js";
import { assertObjectId, GitSourceError } from "./process";
import type { GitSnapshot } from "./snapshot";

type HistoryPage = Omit<ResultEnvelope, "entries"> & {
	entries: CommitRecord[];
};

function text(bytes: Uint8Array) {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		throw new GitSourceError("unsupported", "History is not valid UTF-8");
	}
}

/** First-parent log pinned to the imported commit; each diff compares that commit
 * to its first parent. Path filtering does not follow renames or change the diff. */
export async function readHistory(
	snapshot: GitSnapshot,
	request: ReadHistoryRequest,
): Promise<HistoryPage> {
	snapshot.assertOpen();
	if (!validRequest(request)) {
		throw new GitSourceError("invalid_request", "Invalid history request");
	}
	if (request.snapshotId !== snapshot.summary.snapshotId) {
		throw new GitSourceError("source_unavailable", "Snapshot unavailable");
	}
	if (request.entryId) {
		snapshot.entry(request.entryId);
	}
	const limit = request.maxCommits ?? 20;
	const signature = (offset: number) =>
		createHmac("sha256", snapshot.cursorSecret)
			.update(
				JSON.stringify([
					"history",
					request.snapshotId,
					request.entryId ?? null,
					limit,
					offset,
				]),
			)
			.digest("hex");
	let offset = 0;
	if (request.cursor) {
		const [position, mac] = request.cursor.split(":");
		offset = Number(position);
		if (
			!/^\d+:[0-9a-f]{64}$/.test(request.cursor) ||
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset >= 1000 ||
			!timingSafeEqual(Buffer.from(mac), Buffer.from(signature(offset)))
		) {
			throw new GitSourceError("cursor_invalid", "Invalid history cursor");
		}
	}
	const deadline = Date.now() + 5000;
	const ids = await snapshot.historyIds(
		offset,
		Math.min(limit, 1000 - offset) + 1,
		deadline,
		request.entryId,
	);
	const result: HistoryPage = {
		kind: "history",
		scope: { snapshotIds: [request.snapshotId] },
		entries: [],
		coverage: { status: "complete" },
		nextCursor: null,
		truncated: { is: false },
		freshness: { indexedAt: snapshot.summary.indexedAt, stale: false },
	};
	for (const commit of ids.slice(0, Math.min(limit, 1000 - offset))) {
		const raw = text(await snapshot.historyObject(commit, deadline));
		const separator = raw.indexOf("\n\n");
		const headers = raw.slice(0, separator).split("\n");
		const parents = headers
			.filter((line) => line.startsWith("parent "))
			.map((line) => line.slice(7));
		for (const parent of parents) {
			assertObjectId(parent, snapshot.summary.hashAlgorithm);
		}
		const timestamp = headers
			.find((line) => line.startsWith("committer "))
			?.match(/ (-?\d+) [+-]\d{4}$/)?.[1];
		const comparedTo = parents[0] ?? null;
		const changed = text(
			await snapshot.changedPaths(commit, comparedTo, deadline),
		);
		const record = {
			commit,
			hashAlgorithm: snapshot.summary.hashAlgorithm,
			parents,
			comparedTo,
			subject: raw.slice(separator + 2).split("\n")[0],
			committedAt: Number(timestamp) * 1000,
			changedPaths: changed.split("\0").filter(Boolean),
		};
		if (
			separator < 0 ||
			!Number.isSafeInteger(record.committedAt) ||
			!validRecord(record)
		) {
			throw new GitSourceError(
				"limit_exceeded",
				"Commit metadata exceeds supported history bounds",
			);
		}
		if (
			Buffer.byteLength(
				JSON.stringify({ ...result, entries: [...result.entries, record] }),
			) > 15000
		) {
			if (!result.entries.length) {
				throw new GitSourceError(
					"limit_exceeded",
					"Commit exceeds response cap",
				);
			}
			break;
		}
		result.entries.push(record as CommitRecord);
	}
	const end = offset + result.entries.length;
	if (ids.length > result.entries.length) {
		result.coverage.status = "partial";
		result.truncated = {
			is: true,
			reason: result.entries.length < limit ? "response_cap" : "page_limit",
		};
		result.nextCursor = end < 1000 ? `${end}:${signature(end)}` : null;
	}
	return result;
}
