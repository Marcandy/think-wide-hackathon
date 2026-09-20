import type { SourceRef } from "../../../generated/types";

export type Evidence = {
	id: string;
	repository: string;
	ref: SourceRef;
	excerpt: string;
	status: "available" | "unavailable";
};

type EvidencePairProps = {
	left: Evidence;
	right: Evidence;
	caption?: string;
};

export function EvidencePair({ left, right, caption }: EvidencePairProps) {
	const sources = [
		{ slot: "A", source: left },
		{ slot: "B", source: right },
	];

	return (
		<div>
			{caption && <p>{caption}</p>}
			<div className="evidence-pair">
				{sources.map(({ slot, source }) => (
					<article className="source-card" key={slot}>
						<div className="source-heading">
							<span className="eyebrow">Source {slot}</span>
							<span className="pill">Synthetic</span>
						</div>
						<h3>{source.repository}</h3>
						<p className="source-path">
							{source.ref.displayPath ?? source.ref.entryId}
						</p>
						<div className="source-meta">
							<span>Commit {source.ref.commit.slice(0, 7)}</span>
							<span>
								Lines{" "}
								{source.ref.lineRange
									? `${source.ref.lineRange.start}–${source.ref.lineRange.end}`
									: "not provided"}
							</span>
						</div>
						{source.status === "available" ? (
							<pre>
								<code>{source.excerpt}</code>
							</pre>
						) : (
							<output className="empty-state">
								Source unavailable. The original excerpt cannot be displayed.
							</output>
						)}
						<details>
							<summary>Source identity</summary>
							<dl className="identity">
								<dt>Fixture ID</dt>
								<dd>{source.id}</dd>
								<dt>Fixture commit</dt>
								<dd>{source.ref.commit}</dd>
								<dt>Blob</dt>
								<dd>{source.ref.blobId}</dd>
								<dt>Byte range</dt>
								<dd>
									[{source.ref.byteRange.start}, {source.ref.byteRange.end})
								</dd>
								<dt>SHA-256</dt>
								<dd>{source.ref.digest}</dd>
								<dt>Provenance</dt>
								<dd>
									Authored workshop sample. Exact Git bytes and hashes are not
									connected.
								</dd>
							</dl>
						</details>
					</article>
				))}
			</div>
		</div>
	);
}
