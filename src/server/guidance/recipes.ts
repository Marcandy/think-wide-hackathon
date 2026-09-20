import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Recipe } from "../../../generated/types.ts";

/**
 * T07 · readGuidance content.
 *
 * Recipes are operator-authored Markdown with a small frontmatter header, reviewed like
 * rules. They are never generated from ingested source and never from a model, so
 * guidance cannot be steered by a scanned repository.
 *
 * `contentHash` is the sha256 of the exact file bytes: guidance quoted in a brief stays
 * attributable to the reviewed revision, the same way a finding stays attributable to a
 * rule hash.
 *
 * Contract: contracts/schemas/recipe.schema.json, entries for readGuidance
 * (decisions/0001). The schema is a contract change and needs @heyoub's review.
 */

const RECIPES_DIR = join(dirname(fileURLToPath(import.meta.url)), "recipes");

function parseFrontmatter(text: string): {
	header: Record<string, string>;
	body: string;
} {
	if (!text.startsWith("---\n"))
		throw new Error("recipe is missing its frontmatter header");
	const end = text.indexOf("\n---\n", 3);
	if (end < 0) throw new Error("recipe frontmatter is not terminated");
	const header: Record<string, string> = {};
	for (const line of text.slice(4, end).split("\n")) {
		if (!line.trim()) continue;
		const at = line.indexOf(":");
		if (at < 0)
			throw new Error(`recipe frontmatter line is not a pair: ${line}`);
		header[line.slice(0, at).trim()] = line.slice(at + 1).trim();
	}
	return { header, body: text.slice(end + 5) };
}

/** First non-empty paragraph under the first heading, used as the catalog summary. */
function firstParagraph(body: string): string {
	for (const block of body.split("\n\n")) {
		const text = block.trim();
		if (!text || text.startsWith("#") || text.startsWith("|")) continue;
		return text.replace(/\s+/g, " ").slice(0, 512);
	}
	throw new Error("recipe has no prose paragraph to summarize");
}

/**
 * Loads the reviewed recipes. `withBody` is false for the catalog listing and true when
 * one recipe is requested, which is the same distinction readGuidance exposes.
 */
export function loadRecipes(withBody = false): readonly Recipe[] {
	return readdirSync(RECIPES_DIR)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((file) => {
			const bytes = readFileSync(join(RECIPES_DIR, file));
			const { header, body } = parseFrontmatter(bytes.toString("utf8"));
			for (const key of ["recipeId", "title", "appliesTo"]) {
				if (!header[key]) throw new Error(`recipe ${file} is missing ${key}`);
			}
			const recipe: Recipe = {
				recipeId: header.recipeId as string,
				title: header.title as string,
				appliesTo: header.appliesTo as string,
				summary: firstParagraph(body),
				contentHash: createHash("sha256").update(bytes).digest("hex"),
				...(withBody ? { body } : {}),
			};
			return Object.freeze(recipe);
		});
}

export function getRecipe(recipeId: string): Recipe | null {
	return loadRecipes(true).find((r) => r.recipeId === recipeId) ?? null;
}
