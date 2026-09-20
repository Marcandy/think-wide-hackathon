import { useForm } from "@tanstack/react-form";
import { useId } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import type { RecordDecisionRequest } from "../../../generated/types";

export type DecisionDraft = {
	kind: RecordDecisionRequest["kind"];
	text: string;
};

const decisionKindLabels = {
	constraint: "Constraint",
	correction: "Correction",
	rejection: "Rejection",
	acceptance: "Acceptance",
} satisfies Record<DecisionDraft["kind"], string>;

function isDecisionKind(value: string): value is DecisionDraft["kind"] {
	return Object.hasOwn(decisionKindLabels, value);
}

// The heading over the human decision form is fixed product text. Text authored by a model
// (the composition prompt) is shown beneath it and labeled as a suggestion, because this is
// the one place a human exercises authority and source text can steer what a model writes.
export const DECISION_EDITOR_HEADING = "Your judgment belongs here";

type ConstraintEditorProps = {
	suggestion?: string;
	draft: DecisionDraft;
	onDraftChange: (draft: DecisionDraft) => void;
	onPreview: (draft: DecisionDraft) => void;
};

export function validateDecisionText(value: string) {
	// The contract allows any non-empty statement; "No worker" is a complete constraint.
	if (value.trim().length === 0) {
		return "Write your decision before previewing it.";
	}

	if (value.length > 2000) {
		return "Keep your decision within 2,000 characters.";
	}

	return undefined;
}

export function ConstraintEditor({
	suggestion,
	draft,
	onDraftChange,
	onPreview,
}: ConstraintEditorProps) {
	const fieldId = useId();
	const form = useForm({
		defaultValues: draft,
		onSubmit: ({ value }) => onPreview({ ...value, text: value.text.trim() }),
	});

	return (
		<article className="editor-card">
			<span className="eyebrow">Human direction</span>
			<h3>{DECISION_EDITOR_HEADING}</h3>
			{suggestion ? (
				<p className="field-help">
					<span className="eyebrow">Suggested by the agent</span> {suggestion}
				</p>
			) : null}
			<p>
				You know the constraints. Give the next comparison a better starting
				point.
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="kind">
					{(field) => (
						<div className="form-field">
							<Label htmlFor={`${fieldId}-kind`}>Decision type</Label>
							<select
								id={`${fieldId}-kind`}
								value={field.state.value}
								onChange={(event) => {
									const value = event.target.value;
									if (isDecisionKind(value)) {
										field.handleChange(value);
										onDraftChange({ ...draft, kind: value });
									}
								}}
							>
								{Object.entries(decisionKindLabels).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</div>
					)}
				</form.Field>
				<form.Field
					name="text"
					// onChange validators also run on submit (TanStack Form), so a separate onSubmit
					// validator only duplicated the message.
					validators={{ onChange: ({ value }) => validateDecisionText(value) }}
				>
					{(field) => (
						<div className="form-field">
							<Label htmlFor={`${fieldId}-text`}>Your direction</Label>
							<Textarea
								id={`${fieldId}-text`}
								rows={4}
								placeholder="Keep the contract, but avoid a persistent worker…"
								value={field.state.value}
								maxLength={2000}
								aria-invalid={field.state.meta.errors.length > 0}
								aria-describedby={`${fieldId}-help ${fieldId}-error`}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									onDraftChange({ ...draft, text: event.target.value });
								}}
							/>
							<p id={`${fieldId}-help`} className="field-help">
								Local preview only. Drafts stay while switching workshop views;
								reloading clears them.
							</p>
							<p id={`${fieldId}-error`} className="field-error" role="alert">
								{field.state.meta.errors.join(" ")}
							</p>
						</div>
					)}
				</form.Field>
				<Button type="submit">
					Preview decision <span aria-hidden="true">↗</span>
				</Button>
			</form>
		</article>
	);
}
