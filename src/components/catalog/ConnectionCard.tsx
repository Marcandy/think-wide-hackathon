import { ArrowUpRight, GitCompareArrows } from "lucide-react";
import type { ConnectionCardNode } from "../../../generated/types";

export type Connection = {
	status: ConnectionCardNode["status"];
	title: string;
	description: string;
	caveat: string;
	evidence: string[];
};

type ConnectionCardProps = {
	connection: Connection;
	rationale?: string;
};

export function ConnectionCard({ connection, rationale }: ConnectionCardProps) {
	return (
		<article className="connection-card">
			<div className="connection-icon">
				<GitCompareArrows aria-hidden="true" size={24} />
			</div>
			<div>
				<div className="source-heading">
					<span className="eyebrow">A possible connection</span>
					<span className="pill">
						{connection.status === "tentative"
							? "Hypothesis"
							: connection.status}
					</span>
				</div>
				<h3>{connection.title}</h3>
				<p>{rationale ?? connection.description}</p>
				<p className="connection-caveat">{connection.caveat}</p>
				<div className="source-meta">
					<ArrowUpRight size={14} aria-hidden="true" /> Based on{" "}
					{connection.evidence.length} synthetic sources · not verified
				</div>
			</div>
		</article>
	);
}
