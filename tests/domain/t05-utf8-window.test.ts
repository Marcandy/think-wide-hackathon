import { describe, expect, it } from "vitest";
import { SourceReadError, sourceWindow } from "../../core/source-ref";
import type { ReadSourceRequest } from "../../generated/types";

const base: ReadSourceRequest = { snapshotId: "s", entryId: "e" };
const encode = (text: string) => new TextEncoder().encode(text);

function readAll(bytes: Uint8Array, maxBytes?: number) {
	const pages: string[] = [];
	let request: ReadSourceRequest = {
		...base,
		...(maxBytes ? { maxBytes } : {}),
	};
	for (let guard = 0; guard < 1000; guard++) {
		const page = sourceWindow(bytes, request);
		pages.push(page.content);
		if (!page.nextRange) {
			return pages;
		}
		request = { ...request, byteRange: page.nextRange };
	}
	throw new Error("paging did not terminate");
}

describe("T05 server-chosen read window and UTF-8 boundaries", () => {
	it("pages a file whose multi-byte character straddles the default 16 KiB window", () => {
		const text = `${"a".repeat(16383)}é${"b".repeat(100)}`;
		const bytes = encode(text);
		const first = sourceWindow(bytes, base);
		expect(first.end).toBe(16383);
		expect(first.rangeAdjusted).toBe(true);
		expect(first.nextRange).toEqual({ start: 16383, end: bytes.length });
		expect(readAll(bytes).join("")).toBe(text);
	});

	it("reassembles exactly for 2-, 3- and 4-byte characters at every small window size", () => {
		const text = "aé€𝕏b—終";
		const bytes = encode(text);
		for (let maxBytes = 4; maxBytes <= 12; maxBytes++) {
			expect(readAll(bytes, maxBytes).join("")).toBe(text);
		}
	});

	it("still rejects an explicit caller range that splits a character", () => {
		const bytes = encode("aéb");
		expect(() =>
			sourceWindow(bytes, { ...base, byteRange: { start: 0, end: 2 } }),
		).toThrow(SourceReadError);
	});

	it("reports a window smaller than one character instead of looping or returning nothing", () => {
		const bytes = encode("𝕏");
		try {
			sourceWindow(bytes, { ...base, maxBytes: 2 });
			throw new Error("expected a rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(SourceReadError);
			expect((error as SourceReadError).code).toBe("limit_exceeded");
		}
	});
});
