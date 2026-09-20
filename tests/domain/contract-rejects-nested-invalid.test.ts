import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as v from "../../generated/validators.js";

const sha = "a".repeat(40);
const digest = "b".repeat(64);
const ref = {
	repositoryId: "repo_a",
	commit: sha,
	hashAlgorithm: "sha1",
	blobId: sha,
	entryId: "entry_1",
	byteRange: { start: 0, end: 120 },
	digest,
};
const proposal = (r: unknown) => ({
	proposal: {
		investigationId: "inv_1",
		baseRevision: 0,
		claims: [
			{
				statement: "A and B share a command contract",
				evidenceClass: "model_hypothesis",
				refs: [r],
			},
		],
	},
	requestKey: "req-00000001",
});

describe("generated validators (contract 0.1.0)", () => {
	it("accepts a well-formed nested request", () => {
		expect(v.SubmitProposalRequest(proposal(ref))).toBe(true);
	});

	it("rejects an invalid value three levels down (branch name instead of a full commit id)", () => {
		expect(v.SubmitProposalRequest(proposal({ ...ref, commit: "main" }))).toBe(
			false,
		);
		expect(v.SubmitProposalRequest.errors?.[0]?.instancePath).toBe(
			"/proposal/claims/0/refs/0/commit",
		);
	});

	it("rejects unknown nested properties, including caller-supplied identity", () => {
		expect(v.SubmitProposalRequest(proposal({ ...ref, owner: "user_b" }))).toBe(
			false,
		);
		expect(
			v.RecordDecisionRequest({
				investigationId: "inv_1",
				expectedRevision: 0,
				kind: "correction",
				statement: "contract only; no persistent worker",
				requestKey: "req-00000002",
				actor: "admin",
			}),
		).toBe(false);
	});

	it("rejects a claim that cites no evidence", () => {
		const p = proposal(ref);
		p.proposal.claims[0].refs = [];
		expect(v.SubmitProposalRequest(p)).toBe(false);
	});

	it("rejects catalog components outside the closed list and script-like props", () => {
		const bad = {
			catalogVersion: "1",
			root: { component: "Html", html: "<script>alert(1)</script>" },
		};
		expect(v.Composition(bad)).toBe(false);
		const ok = {
			catalogVersion: "1",
			root: {
				component: "Stack",
				children: [{ component: "EvidencePair", left: ref, right: ref }],
			},
		};
		expect(v.Composition(ok)).toBe(true);
	});

	it("pairs search mode with its query shape (discriminated union)", () => {
		const base = { snapshotIds: ["s1"] };
		expect(
			v.SearchSourcesRequest({
				...base,
				mode: "literal",
				query: { ruleId: "r1" },
			}),
		).toBe(false);
		expect(
			v.SearchSourcesRequest({
				...base,
				mode: "structural",
				query: { text: "x" },
			}),
		).toBe(false);
		expect(
			v.SearchSourcesRequest({
				...base,
				mode: "literal",
				query: { text: "x", caseSensitive: true },
			}),
		).toBe(true);
		expect(
			v.SearchSourcesRequest({
				...base,
				mode: "structural",
				query: { ruleId: "r1" },
			}),
		).toBe(true);
	});

	it("accepts only https issue URLs on a handoff publication", () => {
		const handoff = (issueUrl: string) => ({
			handoffId: "handoff_1",
			handoffRevision: 1,
			investigationId: "inv_1",
			investigationRevision: 0,
			objective: "Align the command contract between A and B",
			targetRepository: { repositoryId: "repo_a", baseCommit: sha },
			constraints: [],
			evidence: [],
			acceptance: [{ behavior: "A and B agree", status: "not_run" }],
			audience: "private_issue",
			bodyMarkdown: "# Handoff",
			bodyHash: digest,
			preparedAt: 1700000000000,
			publication: { status: "published", issueUrl },
		});
		expect(v.Handoff(handoff("https://github.com/o/r/issues/1"))).toBe(true);
		expect(v.Handoff(handoff("javascript:alert(1)"))).toBe(false);
		expect(v.Handoff.errors?.[0]?.instancePath).toBe("/publication/issueUrl");
		expect(v.Handoff(handoff("http://github.com/o/r/issues/1"))).toBe(false);
	});

	it("emits ESM validators with no CommonJS require()", () => {
		const source = readFileSync(
			resolve(import.meta.dirname, "../../generated/validators.js"),
			"utf8",
		);
		expect(source).not.toContain("require(");
	});
});
