import { Download } from "lucide-react";
import { Button } from "#/components/ui/button";

export type Handoff = {
	revision: number;
	title: string;
	body: string;
};

type HandoffPreviewProps = {
	handoff: Handoff;
	onExport: (handoff: Handoff) => void;
};

export function HandoffPreview({ handoff, onExport }: HandoffPreviewProps) {
	return (
		<article className="handoff-card">
			<div className="source-heading">
				<span className="eyebrow">From insight to implementation</span>
				<span className="pill">Sample brief</span>
			</div>
			<h3>{handoff.title}</h3>
			<pre>{handoff.body}</pre>
			<Button variant="outline" onClick={() => onExport(handoff)}>
				<Download size={16} aria-hidden="true" /> Download sample .md
			</Button>
			<p className="field-help">
				Exports this synthetic text. No issue is created and no agent is
				dispatched.
			</p>
		</article>
	);
}
