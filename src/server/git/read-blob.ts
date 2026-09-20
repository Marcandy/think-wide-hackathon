import { createHash } from "node:crypto";
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
	for (const range of [request.byteRange, request.lineRange]) {
		if (
			range &&
			(!Number.isSafeInteger(range.start) ||
				!Number.isSafeInteger(range.end) ||
				range.end < range.start)
		) {
			throw new GitSourceError("invalid_request", "Invalid source range");
		}
	}
	if (request.snapshotId !== snapshot.summary.snapshotId) {
		throw new GitSourceError("source_unavailable", "Snapshot unavailable");
	}
	const entry = snapshot.entry(request.entryId);
	const bytes = await snapshot.blob(request.entryId);
	if (
		bytes
			.subarray(0, 128)
			.toString("utf8")
			.startsWith("version https://git-lfs.github.com/spec/v1\n")
	) {
		throw new GitSourceError(
			"unsupported",
			"LFS content is not fetched automatically",
		);
	}
	let start = request.byteRange?.start ?? 0;
	let end = request.byteRange?.end ?? bytes.length;
	if (request.lineRange) {
		const starts = [0];
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] === 10 && i + 1 < bytes.length) {
				starts.push(i + 1);
			}
		}
		if (
			request.lineRange.start > starts.length ||
			request.lineRange.end > starts.length
		) {
			throw new GitSourceError("invalid_request", "Line range exceeds blob");
		}
		start = starts[request.lineRange.start - 1];
		end = starts[request.lineRange.end] ?? bytes.length;
	}
	if (start > bytes.length || end > bytes.length) {
		throw new GitSourceError("invalid_request", "Byte range exceeds blob");
	}
	const requestedEnd = end;
	const cap = request.maxBytes ?? 16384;
	end = Math.min(end, start + cap);
	let text: string;
	try {
		// Reject split UTF-8 and binary instead of replacing bytes with U+FFFD.
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes.subarray(start, end),
		);
	} catch {
		throw new GitSourceError(
			"invalid_request",
			"Select a range on UTF-8 character boundaries",
		);
	}
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
		content: text,
		blobSize: bytes.length,
		evidenceClass: "observed_literal",
		rangeAdjusted: end !== requestedEnd,
		...(end < requestedEnd
			? { nextRange: { start: end, end: requestedEnd } }
			: {}),
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
