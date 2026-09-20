// generated/mcp-tools.ts is data for the T08 MCP adapter. These tests hold it to the registry and
// to the standalone validators: a bundled schema that accepts what the real validator rejects is
// worse than no schema.
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import {
	MCP_TOOL_NAMES,
	MCP_TOOLS,
	type McpToolName,
} from "../../generated/mcp-tools";
import { OPERATION_HANDLERS, OPERATIONS } from "../../generated/operations";
import * as v from "../../generated/validators.js";

const exposed = OPERATIONS.filter((o) =>
	(o.exposure as readonly string[]).includes("mcp"),
);
const compileAlone = (schema: unknown) =>
	new Ajv2020({ strict: true, allErrors: true }).compile(schema as object);
const refsIn = (node: unknown): string[] =>
	Array.isArray(node)
		? node.flatMap(refsIn)
		: typeof node === "object" && node !== null
			? Object.entries(node).flatMap(([key, value]) =>
					key === "$ref" && typeof value === "string" ? [value] : refsIn(value),
				)
			: [];

describe("MCP tool descriptors: registry projection", () => {
	it("describes exactly the MCP-exposed operations, in registry order", () => {
		expect(MCP_TOOLS.map((t) => t.name)).toEqual(
			exposed.map((o) => o.operationId),
		);
		expect([...MCP_TOOL_NAMES]).toEqual(MCP_TOOLS.map((t) => t.name));
		expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
	});

	it("leaves out operations that are not MCP-exposed", () => {
		const hidden = OPERATIONS.filter((o) => !exposed.includes(o)).map(
			(o) => o.operationId,
		);
		expect(hidden).toContain("requestAnalysis");
		for (const id of hidden)
			expect(MCP_TOOL_NAMES as readonly string[]).not.toContain(id);
	});

	it("restates nothing: name, description, effect and handler come from the registry", () => {
		const handlers: Record<string, string> = OPERATION_HANDLERS;
		for (const tool of MCP_TOOLS) {
			const op = OPERATIONS.find((o) => o.operationId === tool.operationId);
			expect(op).toBeDefined();
			expect(tool.name).toBe(tool.operationId);
			expect(tool.description).toBe(op?.summary);
			expect(tool.effect).toBe(op?.effect);
			expect(tool.handler).toBe(handlers[tool.operationId] ?? null);
		}
		expect(MCP_TOOLS.some((t) => t.handler === null)).toBe(true);
		expect(MCP_TOOLS.some((t) => t.handler !== null)).toBe(true);
	});
});

describe("MCP tool descriptors: self-contained input schemas", () => {
	it("every $ref is local and resolves inside its own descriptor", () => {
		for (const tool of MCP_TOOLS) {
			const defs: Record<string, unknown> =
				"$defs" in tool.inputSchema ? tool.inputSchema.$defs : {};
			for (const ref of refsIn(tool.inputSchema)) {
				expect(ref.startsWith("#/$defs/"), `${tool.name}: ${ref}`).toBe(true);
				expect(defs, `${tool.name}: ${ref}`).toHaveProperty([
					ref.slice("#/$defs/".length),
				]);
			}
		}
	});

	it("every inputSchema is an object schema that compiles alone on a fresh strict Ajv", () => {
		for (const tool of MCP_TOOLS) {
			expect(tool.inputSchema.type).toBe("object");
			expect(() => compileAlone(tool.inputSchema), tool.name).not.toThrow();
		}
	});

	it("carries no file identity: no absolute paths, no $id, no $schema, no .schema.json", () => {
		const text = JSON.stringify(MCP_TOOLS);
		expect(text).not.toContain(process.cwd());
		expect(text).not.toMatch(/"\$id"|"\$schema"|\.schema\.json|file:\/\//);
	});
});

// ---- equivalence with the standalone validators ----
const id40 = "a".repeat(40);
const id64 = "c".repeat(64);
const requestKey = "request-key-0001";
const sourceRef = (overrides: Record<string, unknown> = {}) => ({
	repositoryId: "repo_a",
	commit: id40,
	hashAlgorithm: "sha1",
	blobId: id40,
	entryId: "entry_1",
	byteRange: { start: 0, end: 120 },
	digest: "b".repeat(64),
	...overrides,
});
const decision = (overrides: Record<string, unknown> = {}) => ({
	investigationId: "inv_1",
	expectedRevision: 3,
	kind: "constraint",
	statement: "Keep the retry budget where repo A put it.",
	requestKey,
	...overrides,
});
const search = (overrides: Record<string, unknown> = {}) => ({
	snapshotIds: ["snap_1"],
	mode: "literal",
	query: { text: "retryBudget" },
	...overrides,
});
const proposal = (
	composition: unknown,
	overrides: Record<string, unknown> = {},
) => ({
	proposal: {
		investigationId: "inv_1",
		baseRevision: 3,
		claims: [
			{
				statement: "Both repos bound retries.",
				evidenceClass: "observed_literal",
				refs: [sourceRef()],
			},
		],
		...(composition === undefined ? {} : { composition }),
		...overrides,
	},
	requestKey,
});
const pair = {
	component: "EvidencePair",
	left: sourceRef(),
	right: sourceRef({ hashAlgorithm: "sha256", commit: id64, blobId: id64 }),
};
const tree = (leaf: unknown) => ({
	catalogVersion: "1",
	root: {
		component: "Stack",
		children: [{ component: "Section", title: "Evidence", children: [leaf] }],
	},
});

type Fixture = [label: string, expected: boolean, instance: unknown];
const cases: Record<string, { validator: v.Validator; fixtures: Fixture[] }> = {
	readInvestigation: {
		validator: v.ReadInvestigationRequest,
		fixtures: [
			["minimal", true, { investigationId: "inv_1" }],
			[
				"detail and cursor",
				true,
				{ investigationId: "inv_1", detail: "full", cursor: "c1" },
			],
			["missing investigationId", false, { detail: "summary" }],
			["unknown detail", false, { investigationId: "inv_1", detail: "all" }],
			["id breaks the pattern", false, { investigationId: "inv 1" }],
			["empty cursor", false, { investigationId: "inv_1", cursor: "" }],
			[
				"identity smuggled at top level",
				false,
				{ investigationId: "inv_1", principalId: "user_1" },
			],
			["not an object", false, "inv_1"],
		],
	},
	recordDecision: {
		validator: v.RecordDecisionRequest,
		fixtures: [
			["minimal", true, decision()],
			[
				"category and refs of both hash algorithms",
				true,
				decision({
					category: "security",
					targetFindingId: "finding_1",
					refs: [pair.left, pair.right],
				}),
			],
			[
				"identity smuggled at top level",
				false,
				decision({ principalId: "user_1" }),
			],
			[
				"identity smuggled inside a nested refs[] item",
				false,
				decision({ refs: [sourceRef({ ownerId: "user_1" })] }),
			],
			[
				"sha256 hashAlgorithm with 40-char ids",
				false,
				decision({ refs: [sourceRef({ hashAlgorithm: "sha256" })] }),
			],
			[
				"sha1 hashAlgorithm with 64-char ids",
				false,
				decision({ refs: [sourceRef({ commit: id64, blobId: id64 })] }),
			],
			["unknown category", false, decision({ category: "style" })],
			["null category", false, decision({ category: null })],
			["request key too short", false, decision({ requestKey: "short" })],
			["negative revision", false, decision({ expectedRevision: -1 })],
			[
				"ref without a byte range",
				false,
				decision({ refs: [sourceRef({ byteRange: undefined })] }),
			],
			[
				"more than 16 refs",
				false,
				decision({ refs: Array.from({ length: 17 }, () => sourceRef()) }),
			],
		],
	},
	searchSources: {
		validator: v.SearchSourcesRequest,
		fixtures: [
			["literal", true, search()],
			[
				"structural",
				true,
				search({ mode: "structural", query: { ruleId: "rule_1" } }),
			],
			[
				"literal with filters",
				true,
				search({
					query: { text: "x", caseSensitive: true },
					languages: ["ts"],
					pathPrefixEntryId: "entry_1",
				}),
			],
			[
				"literal mode with a structural query",
				false,
				search({ query: { ruleId: "rule_1" } }),
			],
			[
				"structural mode with a literal query",
				false,
				search({ mode: "structural" }),
			],
			["mode that is not invocable", false, search({ mode: "semantic" })],
			["no snapshots", false, search({ snapshotIds: [] })],
			["duplicate snapshots", false, search({ snapshotIds: ["s", "s"] })],
			["three snapshots", false, search({ snapshotIds: ["a", "b", "c"] })],
			[
				"identity smuggled at top level",
				false,
				search({ principalId: "user_1" }),
			],
			[
				"extra field inside the query",
				false,
				search({ query: { text: "x", regex: true } }),
			],
		],
	},
	submitProposal: {
		validator: v.SubmitProposalRequest,
		fixtures: [
			["no composition", true, proposal(undefined)],
			["nested composition", true, proposal(tree(pair))],
			[
				"unknown catalog component",
				false,
				proposal(tree({ component: "Iframe", src: "https://example.com" })),
			],
			[
				"unknown component at the root",
				false,
				proposal({ catalogVersion: "1", root: { component: "Script" } }),
			],
			[
				"extra field on a nested node",
				false,
				proposal(tree({ ...pair, onClick: "alert(1)" })),
			],
			[
				"bad source ref three levels down",
				false,
				proposal(
					tree({ ...pair, left: sourceRef({ hashAlgorithm: "sha256" }) }),
				),
			],
			[
				"empty children",
				false,
				proposal({
					catalogVersion: "1",
					root: { component: "Stack", children: [] },
				}),
			],
			[
				"identity smuggled into the proposal",
				false,
				proposal(undefined, { principalId: "user_1" }),
			],
			["no claims", false, proposal(undefined, { claims: [] })],
			["missing requestKey", false, { proposal: proposal(undefined).proposal }],
		],
	},
};

describe("MCP tool descriptors: bundled schema agrees with the standalone validator", () => {
	for (const [name, { validator, fixtures }] of Object.entries(cases)) {
		const tool = MCP_TOOLS.find((t) => t.name === (name as McpToolName));
		it.each(fixtures)(`${name}: %s`, (_label, expected, instance) => {
			if (!tool) throw new Error(`no descriptor for ${name}`);
			// JSON round trip: what a transport would deliver (drops undefined members).
			const wire = JSON.parse(JSON.stringify(instance));
			expect(validator(wire)).toBe(expected);
			expect(compileAlone(tool.inputSchema)(wire)).toBe(expected);
		});
	}
});
