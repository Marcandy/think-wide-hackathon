import type {
	Evidence,
	OperationError,
	Project,
	ReadSourceRequest,
	SnapshotEntry,
	SourceRef,
} from "../generated/types";

export class SourceReadError extends Error {
	constructor(
		readonly code: OperationError["code"],
		message: string,
	) {
		super(message);
		this.name = "SourceReadError";
	}
}

export function validateIndexedRef(
	ref: SourceRef,
	project: Project,
	entry: SnapshotEntry,
) {
	const snapshot = project.snapshots.find(
		(item) => item.snapshotId === ref.snapshotId,
	);
	if (
		!snapshot ||
		ref.repositoryId !== project.repositoryId ||
		ref.snapshotId !== entry.snapshotId ||
		ref.entryId !== entry.entryId ||
		ref.commit !== snapshot.commit ||
		ref.hashAlgorithm !== snapshot.hashAlgorithm ||
		ref.blobId !== entry.objectId ||
		entry.kind !== "blob" ||
		entry.size === undefined ||
		!Number.isSafeInteger(ref.byteRange.start) ||
		!Number.isSafeInteger(ref.byteRange.end) ||
		ref.byteRange.start < 0 ||
		ref.byteRange.end < ref.byteRange.start ||
		ref.byteRange.end > entry.size
	) {
		throw new SourceReadError(
			"invalid_request",
			"Source reference does not match its indexed entry",
		);
	}
}

export function sourceWindow(bytes: Uint8Array, request: ReadSourceRequest) {
	if (request.byteRange && request.lineRange) {
		throw new SourceReadError(
			"invalid_request",
			"Specify one byte or line range",
		);
	}
	for (const range of [request.byteRange, request.lineRange]) {
		if (
			range &&
			(!Number.isSafeInteger(range.start) ||
				!Number.isSafeInteger(range.end) ||
				range.start < 0 ||
				range.end < range.start)
		) {
			throw new SourceReadError("invalid_request", "Invalid source range");
		}
	}
	if (
		new TextDecoder()
			.decode(bytes.subarray(0, 128))
			.startsWith("version https://git-lfs.github.com/spec/v1\n")
	) {
		throw new SourceReadError(
			"unsupported",
			"LFS content is not fetched automatically",
		);
	}
	let start = request.byteRange?.start ?? 0;
	let end = request.byteRange?.end ?? bytes.length;
	if (request.lineRange) {
		const starts = [0];
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] === 10 && i + 1 < bytes.length) starts.push(i + 1);
		}
		if (
			request.lineRange.start < 1 ||
			request.lineRange.start > starts.length ||
			request.lineRange.end > starts.length
		) {
			throw new SourceReadError("invalid_request", "Line range exceeds blob");
		}
		start = starts[request.lineRange.start - 1];
		end = starts[request.lineRange.end] ?? bytes.length;
	}
	if (start > bytes.length || end > bytes.length) {
		throw new SourceReadError("invalid_request", "Byte range exceeds blob");
	}
	const requestedEnd = end;
	end = Math.min(end, start + (request.maxBytes ?? 16384));
	if (end < requestedEnd) {
		// The clamp is chosen by the server, so the caller cannot correct a split character.
		// Retract to a UTF-8 character boundary (continuation bytes are 0b10xxxxxx) and report
		// the served range through rangeAdjusted / nextRange. An explicit caller range that
		// splits a character is still rejected below.
		while (end > start && (bytes[end] & 0xc0) === 0x80) {
			end--;
		}
		if (end === start) {
			throw new SourceReadError(
				"limit_exceeded",
				"maxBytes is smaller than one character at this offset",
			);
		}
	}
	let content: string;
	try {
		content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes.subarray(start, end),
		);
	} catch {
		throw new SourceReadError(
			"invalid_request",
			"Select a range on UTF-8 character boundaries",
		);
	}
	const nextRange: Evidence["nextRange"] =
		end < requestedEnd ? { start: end, end: requestedEnd } : undefined;
	return {
		content,
		start,
		end,
		rangeAdjusted: end !== requestedEnd,
		nextRange,
	};
}
