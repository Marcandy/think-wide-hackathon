import type {
	CatalogNode,
	Composition,
	ConnectionCardNode,
	SourceRef,
} from "../../../generated/types";
import { Composition as validateContract } from "../../../generated/validators.js";

export type { CatalogNode, Composition } from "../../../generated/types";

// The workshop supports the catalog shipped with contract 0.1.0.
export const CATALOG_VERSION = "0.1.0";
export const COMPOSITION_LIMITS = { nodes: 16, depth: 4, bytes: 32 * 1024 };

// This is local rendering context, not a second wire contract or an auth boundary.
export type CompositionContext = {
	investigationId: string;
	revision: number;
	evidenceKeys: ReadonlySet<string>;
	findingStatuses: ReadonlyMap<string, ConnectionCardNode["status"]>;
	handoffRevisions: ReadonlyMap<string, number>;
};

export type CompositionResult =
	| { ok: true; composition: Composition }
	| { ok: false; reason: string };

// Compare exact identities, independent of JSON property order. Presentation
// metadata is read from trusted local data, never used to resolve an address.
export function sourceRefKey(ref: SourceRef): string {
	return JSON.stringify([
		ref.repositoryId,
		ref.snapshotId ?? null,
		ref.hashAlgorithm,
		ref.commit,
		ref.blobId,
		ref.entryId,
		ref.byteRange.start,
		ref.byteRange.end,
		ref.digest,
	]);
}

function isComposition(value: unknown): value is Composition {
	return validateContract(value);
}

// Bound recursion before calling the generated recursive schema validator.
// Shape validation itself remains owned by the generated contract.
function isBoundedTree(root: unknown): boolean {
	const pending = [{ node: root, depth: 1 }];
	let count = 0;

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) {
			break;
		}

		count += 1;
		if (
			count > COMPOSITION_LIMITS.nodes ||
			current.depth > COMPOSITION_LIMITS.depth
		) {
			return false;
		}

		const { node, depth } = current;
		if (
			typeof node === "object" &&
			node !== null &&
			"children" in node &&
			Array.isArray(node.children)
		) {
			if (node.children.length > COMPOSITION_LIMITS.nodes) {
				return false;
			}

			for (const child of node.children) {
				pending.push({ node: child, depth: depth + 1 });
			}
		}
	}

	return true;
}

export function validateComposition(
	serialized: string,
	context: CompositionContext,
): CompositionResult {
	const reject = (reason: string): CompositionResult => ({ ok: false, reason });

	if (
		new TextEncoder().encode(serialized).byteLength > COMPOSITION_LIMITS.bytes
	) {
		return reject("Composition exceeds 32 KiB.");
	}

	let input: unknown;
	try {
		input = JSON.parse(serialized);
	} catch {
		return reject("Composition must be valid JSON.");
	}

	if (
		typeof input === "object" &&
		input !== null &&
		"root" in input &&
		!isBoundedTree(input.root)
	) {
		return reject("Composition exceeds 16 nodes or depth 4.");
	}

	if (!isComposition(input)) {
		return reject(
			"Unknown component, property, or invalid public composition shape.",
		);
	}

	if (input.catalogVersion !== CATALOG_VERSION) {
		return reject("Unsupported catalog version.");
	}

	function knownSource(ref: SourceRef): boolean {
		const hashLength = ref.hashAlgorithm === "sha1" ? 40 : 64;
		return (
			ref.commit.length === hashLength &&
			ref.blobId.length === hashLength &&
			ref.byteRange.end >= ref.byteRange.start &&
			(!ref.lineRange || ref.lineRange.end >= ref.lineRange.start) &&
			context.evidenceKeys.has(sourceRefKey(ref))
		);
	}

	let editorCount = 0;
	function referencesMatch(node: CatalogNode): boolean {
		switch (node.component) {
			case "Stack":
			case "Section":
				return node.children.every(referencesMatch);
			case "EvidencePair":
				return knownSource(node.left) && knownSource(node.right);
			case "ConnectionCard":
				return context.findingStatuses.get(node.findingId) === node.status;
			case "ConstraintEditor":
				editorCount += 1;
				return (
					editorCount === 1 &&
					node.investigationId === context.investigationId &&
					node.expectedRevision === context.revision
				);
			case "HandoffPreview":
				return (
					context.handoffRevisions.get(node.handoffId) === node.handoffRevision
				);
		}
	}

	if (!referencesMatch(input.root)) {
		return reject(
			"Unknown reference, stale revision, mismatched status, or repeated decision editor.",
		);
	}

	return { ok: true, composition: input };
}
