import type { CatalogData } from "#/components/catalog/registry";
import {
	CATALOG_VERSION,
	type Composition,
} from "#/components/catalog/validate-composition";

// Authored UI fixtures, not observations from real repositories or an LLM.
export const workshopData: CatalogData = {
	investigationId: "workshop-investigation",
	revision: 1,
	evidence: {
		"source-a": {
			id: "source-a",
			repository: "atlas-api",
			ref: {
				repositoryId: "atlas-api",
				commit: "a".repeat(40),
				hashAlgorithm: "sha1",
				blobId: "90f1e1ce84cc57b8cc0380430388d424b41af5af",
				entryId: "source-a",
				displayPath: "src/commands/receipt.ts",
				byteRange: { start: 0, end: 154 },
				lineRange: { start: 1, end: 5 },
				digest:
					"092b7a541ba30913a69aa1735b30815d254da83ed42f92b12eb36ba26610df58",
			},
			status: "available",
			excerpt: `const previous = await receipts.find(key);
if (previous) return previous.result;

const result = await execute(command);
await receipts.save(key, result);`,
		},
		"source-b": {
			id: "source-b",
			repository: "orbit-worker",
			ref: {
				repositoryId: "orbit-worker",
				commit: "b".repeat(40),
				hashAlgorithm: "sha1",
				blobId: "dd40f7e12395e4d077a608fdfed38382dd2282cf",
				entryId: "source-b",
				displayPath: "src/jobs/deduplicate.ts",
				byteRange: { start: 0, end: 156 },
				lineRange: { start: 1, end: 5 },
				digest:
					"c034feecd14b4886289e878c834074ed615a4246f5b61c13bf5629dda17158c5",
			},
			status: "available",
			excerpt: `const receipt = await store.lookup(job.key);
if (receipt) return receipt.output;

const output = await processJob(job);
await store.record(job.key, output);`,
		},
	},
	connections: {
		"connection-1": {
			status: "tentative",
			title: "A shared contract for repeated commands",
			description:
				"Both samples look up a receipt before doing work. A common request-key contract could make retry behavior easier to reason about across projects.",
			caveat:
				"Still unknown: concurrent requests, changed payloads, and atomic writes. Similar syntax does not prove equivalent behavior.",
			evidence: ["source-a", "source-b"],
		},
	},
	handoffs: {
		"handoff-1": {
			revision: 1,
			title: "Make the contract reusable",
			body: `# Implementation brief · synthetic sample

Scope
Define a shared command-receipt interface.

Constraints
• Keep execution inside each project.
• Do not introduce a persistent worker.

Evidence
• source-a: atlas-api / receipt.ts (1–5)
• source-b: orbit-worker / deduplicate.ts (1–5)
Authored samples; exact Git references pending.

Acceptance
Same key + same arguments reuses the result.
Same key + changed arguments is a conflict.
Test concurrent requests before adoption.`,
		},
	},
};

export const workshopComposition: Composition = {
	catalogVersion: CATALOG_VERSION,
	root: {
		component: "Stack",
		children: [
			{
				component: "Section",
				title: "01 / Look at the evidence",
				children: [
					{
						component: "EvidencePair",
						left: workshopData.evidence["source-a"].ref,
						right: workshopData.evidence["source-b"].ref,
					},
					{
						component: "ConnectionCard",
						findingId: "connection-1",
						status: "tentative",
					},
				],
			},
			{
				component: "Section",
				title: "02 / Shape the next step",
				children: [
					{
						component: "ConstraintEditor",
						investigationId: workshopData.investigationId,
						expectedRevision: workshopData.revision,
						prompt: "Does the contract apply without the persistent worker?",
					},
					{
						component: "HandoffPreview",
						handoffId: "handoff-1",
						handoffRevision: 1,
					},
				],
			},
		],
	},
};

export const initialComposition = JSON.stringify(workshopComposition, null, 2);
