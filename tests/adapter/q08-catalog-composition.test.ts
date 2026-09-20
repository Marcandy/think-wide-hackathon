import { describe, expect, it } from "vitest";
import type {
	CatalogNode,
	Composition,
	SourceRef,
} from "../../generated/types";
import { Composition as contractAccepts } from "../../generated/validators.js";
import {
	type CompositionContext,
	sourceRefKey,
	validateComposition,
} from "../../src/components/catalog/validate-composition";

// Independent cases: these deliberately do not import the workshop fixtures.
const source: SourceRef = {
	repositoryId: "allowed-repo",
	commit: "a".repeat(40),
	hashAlgorithm: "sha1",
	blobId: "b".repeat(40),
	entryId: "entry-a",
	byteRange: { start: 0, end: 10 },
	digest: "c".repeat(64),
};
const context: CompositionContext = {
	investigationId: "investigation-a",
	revision: 7,
	evidenceKeys: new Set([sourceRefKey(source)]),
	findingStatuses: new Map([["finding-a", "tentative"]]),
	handoffRevisions: new Map([["brief-a", 2]]),
};
const pair: CatalogNode = {
	component: "EvidencePair",
	left: source,
	right: source,
};
const editor: CatalogNode = {
	component: "ConstraintEditor",
	investigationId: "investigation-a",
	expectedRevision: 7,
};
const brief: CatalogNode = {
	component: "HandoffPreview",
	handoffId: "brief-a",
	handoffRevision: 2,
};
const connection: CatalogNode = {
	component: "ConnectionCard",
	findingId: "finding-a",
	status: "tentative",
};
function composition(root: CatalogNode = pair): Composition {
	return { catalogVersion: "0.1.0", root };
}
function validate(root: unknown = pair) {
	return validateComposition(
		JSON.stringify({ catalogVersion: "0.1.0", root }),
		context,
	);
}
function chain(depth: number): CatalogNode {
	let root = pair;
	for (let i = 1; i < depth; i++) {
		root = { component: "Section", title: "Evidence", children: [root] };
	}
	return root;
}

describe("Q08 public catalog boundary", () => {
	it.each([
		pair,
		editor,
		brief,
		connection,
		chain(4),
	])("accepts contract-valid known references: $component", (root) => {
		expect(contractAccepts(composition(root))).toBe(true);
		expect(validate(root).ok).toBe(true);
	});
	it("rejects malformed JSON and the retired flat-node draft", () => {
		expect(validateComposition("{broken", context).ok).toBe(false);
		expect(
			validateComposition(
				JSON.stringify({ version: "workshop-v1", root: "pair", nodes: [] }),
				context,
			).ok,
		).toBe(false);
	});
	it.each([
		"RawHTML",
		"iframe",
		"script",
		"constructor",
		"__proto__",
	])("rejects unknown component %s", (component) => {
		expect(validate({ ...pair, component }).ok).toBe(false);
	});
	it.each([
		"html",
		"style",
		"className",
		"onClick",
		"url",
		"action",
		"props",
		"id",
	])("rejects extra property %s", (property) => {
		expect(validate({ ...editor, [property]: "untrusted" }).ok).toBe(false);
	});
	it("rejects extra envelope properties and unreviewed layout directions", () => {
		expect(
			validateComposition(
				JSON.stringify({ ...composition(), revision: 7 }),
				context,
			).ok,
		).toBe(false);
		expect(
			validate({
				component: "Stack",
				direction: "horizontal",
				children: [pair],
			}).ok,
		).toBe(false);
	});
	it("rejects unknown catalog versions", () => {
		expect(
			validateComposition(
				JSON.stringify({ ...composition(), catalogVersion: "future" }),
				context,
			).ok,
		).toBe(false);
	});
	it.each([
		6, 8,
	])("rejects stale or future decision revision %s", (expectedRevision) => {
		expect(validate({ ...editor, expectedRevision }).ok).toBe(false);
	});
	it("checks investigation, finding, status, handoff identity and revision", () => {
		for (const root of [
			{ ...editor, investigationId: "foreign" },
			{ ...connection, findingId: "foreign" },
			{ ...connection, status: "accepted" },
			{ ...brief, handoffId: "foreign" },
			{ ...brief, handoffRevision: 1 },
		]) {
			expect(validate(root).ok).toBe(false);
		}
	});
	it.each([
		{ repositoryId: "foreign" },
		{ commit: "d".repeat(40) },
		{ blobId: "d".repeat(40) },
		{ entryId: "foreign" },
		{ digest: "d".repeat(64) },
		{ snapshotId: "foreign" },
		{ byteRange: { start: 1, end: 10 } },
		{ hashAlgorithm: "sha256" },
	])("checks the entire exact source identity: %j", (change) => {
		expect(validate({ ...pair, right: { ...source, ...change } }).ok).toBe(
			false,
		);
	});
	it("resolves identity independent of property order and ignores untrusted display metadata", () => {
		const { digest, ...rest } = source;
		const reordered = {
			digest,
			...rest,
			displayPath: "untrusted label",
		};
		expect(sourceRefKey(reordered)).toBe(sourceRefKey(source));
		expect(validate({ ...pair, right: reordered }).ok).toBe(true);
	});
	it("rejects malformed or inverted ranges even if present in context", () => {
		for (const ref of [
			{ ...source, byteRange: { start: 20, end: 10 } },
			{ ...source, lineRange: { start: 2, end: 1 } },
		]) {
			const value = { ...composition(), root: { ...pair, left: ref } };
			expect(
				validateComposition(JSON.stringify(value), {
					...context,
					evidenceKeys: new Set([sourceRefKey(source), sourceRefKey(ref)]),
				}).ok,
			).toBe(false);
		}
	});
	it("checks foreign references under nested layouts", () => {
		expect(
			validate({
				component: "Section",
				title: "Nested",
				children: [{ ...brief, handoffId: "foreign" }],
			}).ok,
		).toBe(false);
	});
	it("accepts depth 4 and rejects depth 5 and extreme depth without throwing", () => {
		expect(validate(chain(4)).ok).toBe(true);
		expect(validate(chain(5)).ok).toBe(false);
		const json =
			'{"catalogVersion":"0.1.0","root":' +
			'{"component":"Stack","children":['.repeat(500) +
			JSON.stringify(pair) +
			"]}".repeat(500) +
			"}";
		expect(validateComposition(json, context).ok).toBe(false);
	});
	it("accepts 16 nodes and rejects 17, while respecting 8 children per layout", () => {
		const section = (count: number) => ({
			component: "Section",
			title: "Evidence",
			children: Array.from({ length: count }, () => pair),
		});
		expect(
			validate({ component: "Stack", children: [section(7), section(6)] }).ok,
		).toBe(true);
		expect(
			validate({ component: "Stack", children: [section(7), section(7)] }).ok,
		).toBe(false);
		expect(validate(section(9)).ok).toBe(false);
	});
	it("rejects empty layouts, missing children, and string child addresses", () => {
		for (const children of [[], ["missing"], [null]]) {
			expect(validate({ component: "Stack", children }).ok).toBe(false);
		}
		expect(validate({ component: "Stack" }).ok).toBe(false);
	});
	it("rejects multiple editors sharing one mutable draft", () => {
		expect(
			validate({ component: "Stack", children: [editor, editor] }).ok,
		).toBe(false);
	});
	it("bounds UTF-8 serialized bytes including whitespace", () => {
		const json = JSON.stringify(composition());
		const bytes = new TextEncoder().encode(json).byteLength;
		expect(
			validateComposition(json + " ".repeat(32768 - bytes), context).ok,
		).toBe(true);
		expect(
			validateComposition(json + " ".repeat(32769 - bytes), context).ok,
		).toBe(false);
		const multibyte = JSON.stringify({ text: "🌍".repeat(9000) });
		expect(multibyte.length).toBeLessThan(32768);
		expect(validateComposition(multibyte, context)).toEqual({
			ok: false,
			reason: "Composition exceeds 32 KiB.",
		});
	});
});
