import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InvestigationAccess } from "../components/behavior/InvestigationAccess";
import { PortfolioNav } from "../components/shell/PortfolioNav";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const navigate = useNavigate();
	return (
		<main className="home-intro">
			<PortfolioNav />
			<p className="eyebrow">Cross-project perspective</p>
			<h1>Think-wide</h1>
			<p>Evidence, human decisions, and clearer implementation briefs.</p>
			<InvestigationAccess
				onOpen={(investigationId) => {
					void navigate({
						to: "/investigations/$investigationId",
						params: { investigationId },
					});
				}}
			/>
			<p className="field-help">
				Repository selection for new investigations is awaiting the source
				connection. The component workshop remains available with clearly
				labeled synthetic samples.
			</p>
		</main>
	);
}
