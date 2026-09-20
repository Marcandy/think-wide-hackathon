import {
	ArrowDown,
	ArrowUpRight,
	Braces,
	Layers3,
	Moon,
	Sun,
} from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import type { Handoff } from "#/components/catalog/HandoffPreview";
import { CatalogView } from "#/components/catalog/registry";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { initialComposition, workshopData } from "./fixtures";
import { initialWorkshopState, workshopReducer } from "./state";

const workshopViews = [
	["comparison", "Comparison"],
	["unavailable", "Unavailable source"],
	["empty", "Empty state"],
] as const;

export function Workshop() {
	const [dark, setDark] = useState(false);
	const [{ view, draft, preview, accepted, notice, rejection }, dispatch] =
		useReducer(workshopReducer, initialWorkshopState);
	const [candidate, setCandidate] = useState(initialComposition);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
		return () => document.documentElement.classList.remove("dark");
	}, [dark]);

	const data =
		view === "unavailable"
			? {
					...workshopData,
					evidence: {
						...workshopData.evidence,
						"source-b": {
							...workshopData.evidence["source-b"],
							status: "unavailable" as const,
						},
					},
				}
			: workshopData;

	function applyComposition(serialized: string) {
		dispatch({ type: "compose", serialized });
	}

	function exportHandoff(handoff: Handoff) {
		const blob = new Blob([handoff.body], {
			type: "text/markdown;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);

		const link = document.createElement("a");
		link.href = url;
		link.download = "think-wide-synthetic-brief.md";
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);

		dispatch({
			type: "notice",
			message:
				"Synthetic brief download requested. No external publication was requested.",
		});
	}

	return (
		<div className="workshop-shell">
			<a className="skip-link" href="#workshop-content">
				Skip to workshop
			</a>
			<header className="workshop-header">
				<a className="brand" href="/workshop">
					<span className="brand-symbol">
						<Layers3 size={23} aria-hidden="true" />
					</span>
					think-wide<span className="brand-dot">.</span>
				</a>
				<div className="header-actions">
					<span className="header-caption">The component workshop</span>
					<Button
						variant="outline"
						size="icon"
						aria-label={dark ? "Use light theme" : "Use dark theme"}
						aria-pressed={dark}
						onClick={() => setDark(!dark)}
					>
						{dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
					</Button>
				</div>
			</header>
			<main id="workshop-content">
				<section className="workshop-intro">
					<div>
						<p className="eyebrow intro-eyebrow">
							<span className="live-dot" /> A space to think across projects
						</p>
						<h1>
							Find the connection.
							<br />
							<span>Keep the context.</span>
						</h1>
						<p className="intro-copy">
							Evidence side by side. Your judgment in the loop.
							<br />A clearer next step for the person or agent doing the work.
						</p>
						<a className="intro-link" href="#catalog">
							Explore the components <ArrowDown size={15} aria-hidden="true" />
						</a>
					</div>
					<aside className="intro-note">
						<span className="note-number">T03</span>
						<span className="eyebrow">Workbench foundations</span>
						<p>
							Small components.
							<br />A wider perspective.
						</p>
						<div className="note-footer">
							<Braces size={18} aria-hidden="true" />
							<span>shadcn/ui + tweakcn</span>
							<ArrowUpRight size={18} aria-hidden="true" />
						</div>
					</aside>
				</section>
				<div className="workshop-disclosure">
					<span className="pill">Synthetic workshop</span>
					<p>
						Authored sample evidence and local interactions. Repository access,
						durable decisions, and live reasoning are not connected.
					</p>
				</div>
				<div className="workshop-toolbar" id="catalog">
					<fieldset className="view-switch" aria-label="Workshop states">
						{workshopViews.map(([value, label]) => (
							<Button
								key={value}
								variant={view === value ? "default" : "ghost"}
								aria-pressed={view === value}
								onClick={() => dispatch({ type: "view", view: value })}
							>
								{label}
							</Button>
						))}
					</fieldset>
					<span className="toolbar-meta">
						06 components{" "}
						<span className="toolbar-separator" aria-hidden="true">
							/
						</span>{" "}
						02 themes
					</span>
				</div>
				{rejection && (
					<p className="notice rejection" role="alert">
						{rejection}
					</p>
				)}
				<output className="status-message">{notice}</output>
				{preview && (
					<aside
						className="decision-preview"
						aria-label="Local decision preview"
					>
						<div>
							<span className="eyebrow">
								Your {preview.kind} · local preview
							</span>
							<p>{preview.text}</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => dispatch({ type: "dismiss-preview" })}
						>
							Dismiss preview
						</Button>
					</aside>
				)}
				{view === "empty" ? (
					<section className="empty-workshop">
						<Layers3 size={32} aria-hidden="true" />
						<h2>Every connection starts with evidence.</h2>
						<p>
							No sources in this sample state. Return to the comparison to
							explore two synthetic excerpts.
						</p>
						<Button
							variant="outline"
							onClick={() => dispatch({ type: "view", view: "comparison" })}
						>
							Show sample comparison
						</Button>
					</section>
				) : (
					<CatalogView
						serialized={accepted}
						data={data}
						draft={draft}
						onDraftChange={(value) => dispatch({ type: "draft", draft: value })}
						onPreview={(value) => dispatch({ type: "preview", draft: value })}
						onExport={exportHandoff}
					/>
				)}
				<details className="composition-inspector">
					<summary>
						<Braces size={17} aria-hidden="true" /> Composition inspector{" "}
						<span>Contract 0.1.0</span>
					</summary>
					<div>
						<p>
							Only the six registered components and their reviewed properties
							are accepted. Maximum 16 nodes, depth 4, and 32 KiB. This is a UI
							workshop using the public contract with synthetic data.
						</p>
						<Label htmlFor="composition-input">Composition JSON</Label>
						<Textarea
							id="composition-input"
							className="composition-input"
							rows={10}
							value={candidate}
							onChange={(event) => setCandidate(event.target.value)}
							spellCheck={false}
						/>
						<div className="inspector-actions">
							<Button
								variant="outline"
								onClick={() => applyComposition(candidate)}
							>
								Apply composition
							</Button>
							<Button
								variant="outline"
								onClick={() =>
									applyComposition(
										'{"catalogVersion":"0.1.0","root":{"component":"RawHTML"}}',
									)
								}
							>
								Try a rejected view
							</Button>
							<Button
								variant="ghost"
								onClick={() => {
									setCandidate(initialComposition);
									applyComposition(initialComposition);
								}}
							>
								Restore sample layout
							</Button>
						</div>
					</div>
				</details>
			</main>
			<footer className="workshop-footer">
				<span>
					think-wide <span aria-hidden="true">↗</span> Evidence. Judgment. Next
					steps.
				</span>
				<span>Workshop · synthetic data · session only</span>
			</footer>
		</div>
	);
}
