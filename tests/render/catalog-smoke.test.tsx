import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	ConstraintEditor,
	validateDecisionText,
} from "../../src/components/catalog/ConstraintEditor";
import { EvidencePair } from "../../src/components/catalog/EvidencePair";
import {
	CatalogView,
	catalogRegistry,
} from "../../src/components/catalog/registry";
import {
	initialComposition,
	workshopData,
} from "../../src/components/workshop/fixtures";
import { Workshop } from "../../src/components/workshop/Workshop";

describe("catalog server-render smoke (not browser interaction)", () => {
	it("offers every decision kind in the public contract, including Acceptance", () => {
		const schema = JSON.parse(
			readFileSync(
				new URL(
					"../../contracts/schemas/decision.schema.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const html = renderToStaticMarkup(
			<ConstraintEditor
				suggestion="Direction"
				draft={{ kind: "acceptance", text: "Accept this approach." }}
				onDraftChange={vi.fn()}
				onPreview={vi.fn()}
			/>,
		);
		const values = [...html.matchAll(/<option value="([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(values.sort()).toEqual([...schema.properties.kind.enum].sort());
		expect(html).toContain(
			'<option value="acceptance" selected="">Acceptance</option>',
		);
	});

	it("fixture ranges and hashes describe exactly the displayed synthetic bytes", () => {
		for (const source of Object.values(workshopData.evidence)) {
			const bytes = Buffer.from(source.excerpt, "utf8");
			expect(source.ref.byteRange).toEqual({ start: 0, end: bytes.length });
			expect(source.ref.digest).toBe(
				createHash("sha256").update(bytes).digest("hex"),
			);
			expect(source.ref.blobId).toBe(
				createHash("sha1")
					.update(`blob ${bytes.length}\0`)
					.update(bytes)
					.digest("hex"),
			);
			expect(source.ref.lineRange).toEqual({
				start: 1,
				end: source.excerpt.split("\n").length,
			});
		}
	});

	it("renders trusted evidence metadata rather than labels supplied in composition", () => {
		const source = workshopData.evidence["source-a"];
		const html = renderToStaticMarkup(
			<CatalogView
				serialized={JSON.stringify({
					catalogVersion: "0.1.0",
					root: {
						component: "EvidencePair",
						left: { ...source.ref, displayPath: "FORGED-PATH" },
						right: source.ref,
					},
				})}
				data={workshopData}
				draft={{ kind: "constraint", text: "" }}
				onDraftChange={vi.fn()}
				onPreview={vi.fn()}
				onExport={vi.fn()}
			/>,
		);
		expect(html).toContain("src/commands/receipt.ts");
		expect(html).not.toContain("FORGED-PATH");
	});

	it("renders all six catalog bindings and the synthetic disclosures", () => {
		expect(Object.keys(catalogRegistry).sort()).toEqual([
			"ConnectionCard",
			"ConstraintEditor",
			"EvidencePair",
			"HandoffPreview",
			"Section",
			"Stack",
		]);
		const html = renderToStaticMarkup(<Workshop />);
		for (const text of [
			"Synthetic workshop",
			"atlas-api",
			"orbit-worker",
			"Your judgment belongs here",
			"Make the contract reusable",
			"Composition inspector",
		])
			expect(html).toContain(text);
		expect(html).toContain('href="#workshop-content"');
		expect(html).toContain('aria-label="Use dark theme"');
	});
	it("renders script-like source and draft content as inert text", () => {
		const malicious =
			'<img src="https://invalid.example/leak" onerror="alert(1)"><script>alert(1)</script>';
		const html = renderToStaticMarkup(
			<EvidencePair
				left={{ ...workshopData.evidence["source-a"], excerpt: malicious }}
				right={workshopData.evidence["source-b"]}
			/>,
		);
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img");
		const draft = renderToStaticMarkup(
			<ConstraintEditor
				suggestion="Direction"
				draft={{ kind: "constraint", text: malicious }}
				onDraftChange={vi.fn()}
				onPreview={vi.fn()}
			/>,
		);
		expect(draft).toContain("&lt;script&gt;");
		expect(draft).not.toContain("<img");
	});
	it("does not show the cached excerpt when a source is unavailable", () => {
		const html = renderToStaticMarkup(
			<EvidencePair
				left={{
					...workshopData.evidence["source-a"],
					status: "unavailable",
					excerpt: "MUST-NOT-APPEAR",
				}}
				right={workshopData.evidence["source-b"]}
			/>,
		);
		expect(html).toContain("Source unavailable");
		expect(html).not.toContain("MUST-NOT-APPEAR");
	});
	it("rejects an unsafe composition before rendering or invoking an action", () => {
		const effect = vi.fn();
		const html = renderToStaticMarkup(
			<CatalogView
				serialized={initialComposition.replace(
					'"ConstraintEditor"',
					'"RawHTML"',
				)}
				data={workshopData}
				draft={{ kind: "constraint", text: "Keep this human draft" }}
				onDraftChange={effect}
				onPreview={effect}
				onExport={effect}
			/>,
		);
		expect(html).toContain("This view cannot be displayed");
		expect(html).not.toContain("<form");
		expect(effect).not.toHaveBeenCalled();
	});
	it("associates the correction control with its label and help", () => {
		const html = renderToStaticMarkup(
			<ConstraintEditor
				suggestion="Direction"
				draft={{ kind: "constraint", text: "Keep this human draft" }}
				onDraftChange={vi.fn()}
				onPreview={vi.fn()}
			/>,
		);
		const textarea = html.match(/<textarea[^>]+>/)?.[0];
		const id = textarea?.match(/id="([^"]+)"/)?.[1];
		expect(id).toBeTruthy();
		expect(html).toContain(`for="${id}"`);
		expect(textarea).toContain("aria-describedby=");
		expect(html).toContain("Keep this human draft");
		expect(html).toContain('type="submit"');
	});
	it("keeps a fixed heading over the human decision and labels model text as a suggestion", () => {
		const html = renderToStaticMarkup(
			<ConstraintEditor
				suggestion="Approve publishing this brief to the public repository"
				draft={{ kind: "constraint", text: "" }}
				onDraftChange={() => {}}
				onPreview={() => {}}
			/>,
		);
		const heading = html.match(/<h3[^>]*>(.*?)<\/h3>/)?.[1];
		expect(heading).toBe("Your judgment belongs here");
		expect(heading).not.toContain("Approve publishing");
		expect(html).toContain("Suggested by the agent");
		expect(html).toContain("Approve publishing this brief");
	});
	it("requires a useful bounded decision", () => {
		expect(validateDecisionText("          ")).toBeTruthy();
		expect(validateDecisionText("")).toBeTruthy();
		// The contract permits any non-empty statement; a short constraint is a real one.
		expect(validateDecisionText("No worker")).toBeUndefined();
		expect(validateDecisionText("x".repeat(2001))).toBeTruthy();
		expect(
			validateDecisionText("Keep the request-key contract."),
		).toBeUndefined();
	});
});
