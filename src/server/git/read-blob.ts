import { createHash } from "node:crypto";
import { sourceWindow } from "../../../core/source-ref";
import type { Evidence, ReadSourceRequest } from "../../../generated/types";
import {
	Evidence as validEvidence,
	ReadSourceRequest as validRequest,
} from "../../../generated/validators.js";
import { GitSourceError } from "./process";
import type { GitSnapshot } from "./snapshot";

export async function readSource(
	snapshot: GitSnapshot,
	request: ReadSourceRequest,
): Promise<Evidence> {
	if (!validRequest(request) || (request.byteRange && request.lineRange)) {
		throw new GitSourceError(
			"invalid_request",
			"Specify one valid byte or line range",
		);
	}
	if (request.snapshotId !== snapshot.summary.snapshotId) {
		throw new GitSourceError("source_unavailable", "Snapshot unavailable");
	}
	const entry = snapshot.entry(request.entryId);
	const bytes = await snapshot.blob(request.entryId);
	const window = sourceWindow(bytes, request);
	const { start, end } = window;
	const evidence: Evidence = {
		ref: {
			repositoryId: snapshot.repositoryId,
			snapshotId: snapshot.summary.snapshotId,
			commit: snapshot.summary.commit,
			hashAlgorithm: snapshot.summary.hashAlgorithm,
			blobId: entry.objectId,
			entryId: entry.entryId,
			displayPath: entry.displayPath,
			byteRange: { start, end },
			digest: createHash("sha256")
				.update(bytes.subarray(start, end))
				.digest("hex"),
		},
		encoding: "utf8",
		content: window.content,
		blobSize: bytes.length,
		evidenceClass: "observed_literal",
		rangeAdjusted: window.rangeAdjusted,
		...(window.nextRange ? { nextRange: window.nextRange } : {}),
	};
	if (!validEvidence(evidence)) {
		throw new GitSourceError("internal", "Invalid evidence result");
	}
	if (Buffer.byteLength(JSON.stringify(evidence)) > 16384) {
		throw new GitSourceError(
			"limit_exceeded",
			"Evidence exceeds the response limit; request a smaller maxBytes window",
		);
	}
	return evidence;
}
