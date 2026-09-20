import type { Finding, SourceRef } from "../../../generated/types";
import { Section } from "../catalog/Section";

export function SourceReference({ reference }: { reference: SourceRef }) {
	return (
		<details className="rounded border p-3 text-sm">
			<summary className="cursor-pointer break-all">
				{reference.displayPath ?? reference.entryId} · bytes [
				{reference.byteRange.start}, {reference.byteRange.end})
			</summary>
			<pre className="mt-3 overflow-auto whitespace-pre-wrap break-all">
				{JSON.stringify(reference, null, 2)}
			</pre>
			<p className="field-help">
				Exact reference metadata. Source bytes are unavailable until the source
				reader is connected; no quotation is reconstructed here.
			</p>
		</details>
	);
}

export function SourceReferences({
	references,
}: {
	references: readonly SourceRef[];
}) {
	const distinct = new Map(
		references.map((reference) => [JSON.stringify(reference), reference]),
	);
	return (
		<>
			{[...distinct].map(([key, reference]) => (
				<SourceReference key={key} reference={reference} />
			))}
		</>
	);
}

export function InvestigationEvidence({
	findings,
}: {
	findings: readonly Finding[];
}) {
	return (
		<Section title="Evidence and hypotheses">
			{findings.length ? (
				<ul className="space-y-4">
					{findings.map((finding) => (
						<li
							className="rounded-lg border bg-card p-5 space-y-3"
							key={finding.findingId}
						>
							<p className="whitespace-pre-wrap break-words">
								{finding.summary}
							</p>
							<p className="text-sm">
								Evidence class: {finding.evidenceClass} · Verification:{" "}
								{finding.verification}
							</p>
							{finding.applicabilityNotes ? (
								<p className="whitespace-pre-wrap break-words text-sm">
									{finding.applicabilityNotes}
								</p>
							) : null}
							<SourceReferences references={finding.refs} />
						</li>
					))}
				</ul>
			) : (
				<p>
					No findings have been recorded yet. Your decisions can be saved
					independently.
				</p>
			)}
		</Section>
	);
}
