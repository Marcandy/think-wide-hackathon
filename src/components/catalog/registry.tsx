import type { ReactNode } from "react";
import { type Connection, ConnectionCard } from "./ConnectionCard";
import { ConstraintEditor, type DecisionDraft } from "./ConstraintEditor";
import { type Evidence, EvidencePair } from "./EvidencePair";
import { type Handoff, HandoffPreview } from "./HandoffPreview";
import { Section } from "./Section";
import { Stack } from "./Stack";
import {
	type CatalogNode,
	sourceRefKey,
	validateComposition,
} from "./validate-composition";

export const catalogRegistry = {
	Stack,
	Section,
	EvidencePair,
	ConnectionCard,
	ConstraintEditor,
	HandoffPreview,
} satisfies Record<CatalogNode["component"], unknown>;

export type CatalogData = {
	investigationId: string;
	revision: number;
	evidence: Record<string, Evidence>;
	connections: Record<string, Connection>;
	handoffs: Record<string, Handoff>;
};

export function compositionContext(data: CatalogData) {
	return {
		investigationId: data.investigationId,
		revision: data.revision,
		evidenceKeys: new Set(
			Object.values(data.evidence).map((source) => sourceRefKey(source.ref)),
		),
		findingStatuses: new Map(
			Object.entries(data.connections).map(([id, connection]) => [
				id,
				connection.status,
			]),
		),
		handoffRevisions: new Map(
			Object.entries(data.handoffs).map(([id, handoff]) => [
				id,
				handoff.revision,
			]),
		),
	};
}

type CatalogViewProps = {
	serialized: string;
	data: CatalogData;
	draft: DecisionDraft;
	onDraftChange: (draft: DecisionDraft) => void;
	onPreview: (draft: DecisionDraft) => void;
	onExport: (handoff: Handoff) => void;
};

// Every render goes through validation. Model-supplied props are never spread
// onto a DOM element. Actions are fixed local callbacks, absent from wire data.
export function CatalogView({
	serialized,
	data,
	draft,
	onDraftChange,
	onPreview,
	onExport,
}: CatalogViewProps) {
	const result = validateComposition(serialized, compositionContext(data));

	if (!result.ok) {
		return (
			<p className="notice" role="alert">
				This view cannot be displayed: {result.reason}
			</p>
		);
	}

	const evidence = new Map(
		Object.values(data.evidence).map((source) => [
			sourceRefKey(source.ref),
			source,
		]),
	);

	function render(node: CatalogNode, path: string): ReactNode {
		switch (node.component) {
			case "Stack":
				return (
					<catalogRegistry.Stack key={path} direction="vertical">
						{node.children.map((child, index) =>
							render(child, `${path}.${index}`),
						)}
					</catalogRegistry.Stack>
				);
			case "Section":
				return (
					<catalogRegistry.Section key={path} title={node.title}>
						{node.children.map((child, index) =>
							render(child, `${path}.${index}`),
						)}
					</catalogRegistry.Section>
				);
			case "EvidencePair": {
				const left = evidence.get(sourceRefKey(node.left));
				const right = evidence.get(sourceRefKey(node.right));
				if (!left || !right) {
					return null;
				}
				return (
					<catalogRegistry.EvidencePair
						key={path}
						left={left}
						right={right}
						caption={node.caption}
					/>
				);
			}
			case "ConnectionCard":
				return (
					<catalogRegistry.ConnectionCard
						key={path}
						connection={data.connections[node.findingId]}
						rationale={node.rationale}
					/>
				);
			case "ConstraintEditor":
				return (
					<catalogRegistry.ConstraintEditor
						key={path}
						title={node.prompt ?? "Your judgment belongs here"}
						draft={draft}
						onDraftChange={onDraftChange}
						onPreview={onPreview}
					/>
				);
			case "HandoffPreview":
				return (
					<catalogRegistry.HandoffPreview
						key={path}
						handoff={data.handoffs[node.handoffId]}
						onExport={onExport}
					/>
				);
		}
	}

	return <>{render(result.composition.root, "root")}</>;
}
