import { createHmac, timingSafeEqual } from "node:crypto";
import type {
	BrowseSnapshotRequest,
	ResultEnvelope,
	SnapshotEntry,
} from "../../../generated/types";
import { BrowseSnapshotRequest as validRequest } from "../../../generated/validators.js";
import { GitSourceError } from "./process";
import type { GitSnapshot } from "./snapshot";

type TreePage = Omit<ResultEnvelope, "entries"> & { entries: SnapshotEntry[] };

export function browseSnapshot(
	snapshot: GitSnapshot,
	request: BrowseSnapshotRequest,
): TreePage {
	snapshot.assertOpen();
	if (!validRequest(request)) {
		throw new GitSourceError("invalid_request", "Invalid browse request");
	}
	if (request.snapshotId !== snapshot.summary.snapshotId) {
		throw new GitSourceError("source_unavailable", "Snapshot unavailable");
	}
	const parent = request.parentEntryId ?? null;
	if (parent !== null && snapshot.entry(parent).kind !== "tree") {
		throw new GitSourceError("invalid_request", "Select a tree entry");
	}
	const children = snapshot.entries.filter(
		(entry) => entry.parentEntryId === parent,
	);
	const signature = (offset: number) =>
		createHmac("sha256", snapshot.cursorSecret)
			.update(JSON.stringify([request.snapshotId, parent, offset]))
			.digest("hex");
	let offset = 0;
	if (request.cursor) {
		const [position, mac] = request.cursor.split(":");
		offset = Number(position);
		if (
			!/^\d+:[0-9a-f]{64}$/.test(request.cursor) ||
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > children.length ||
			!timingSafeEqual(Buffer.from(mac), Buffer.from(signature(offset)))
		) {
			throw new GitSourceError("cursor_invalid", "Invalid tree cursor");
		}
	}
	const entries = children.slice(offset, offset + 100);
	function page(reason: "page_limit" | "response_cap"): TreePage {
		const end = offset + entries.length;
		const more = end < children.length;
		return {
			kind: "tree",
			scope: { snapshotIds: [request.snapshotId] },
			entries,
			coverage: { ...snapshot.coverage },
			nextCursor: more ? `${end}:${signature(end)}` : null,
			freshness: { indexedAt: snapshot.summary.indexedAt, stale: false },
			truncated: more ? { is: true, reason } : { is: false },
		};
	}
	let result = page("page_limit");
	while (Buffer.byteLength(JSON.stringify(result)) > 16384) {
		entries.pop();
		if (entries.length === 0) {
			throw new GitSourceError(
				"limit_exceeded",
				"Tree entry exceeds the response limit",
			);
		}
		result = page("response_cap");
	}
	return result;
}
