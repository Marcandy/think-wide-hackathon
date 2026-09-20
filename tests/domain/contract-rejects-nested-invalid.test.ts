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
});
