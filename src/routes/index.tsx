import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<main className="home-intro">
			<p className="eyebrow">Cross-project perspective</p>
			<h1>Think-wide</h1>
			<p>Evidence, human decisions, and clearer implementation briefs.</p>
			<Button asChild>
				<Link to="/workshop">Open the component workshop</Link>
			</Button>
			<p className="field-help">
				The workshop uses synthetic samples. The connected workbench is still
				being built.
			</p>
		</main>
	);
}
