import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as v from "../../generated/validators.js";
import { getRecipe, loadRecipes } from "../../src/server/guidance/recipes.ts";

/**
 * T07 · readGuidance content against the published contract.
 *
 * Layer: unit. This proves the recipe entries validate and that the content hash is the
 * hash of the real file. It does not exercise a readGuidance handler; that operation is
 * still unimplemented, so readGuidance acceptance is NOT RUN.
 */

describe("guidance recipes", () => {
	it("loads both reviewed recipes and validates them against recipe.schema.json", () => {
		const recipes = loadRecipes();
		expect(recipes.map((r) => r.recipeId).sort()).toEqual([
			"recipe.search.literal",
			"recipe.search.structural",
		]);
		for (const recipe of recipes) expect(v.Recipe(recipe)).toBe(true);
	});

	it("omits the body from the catalog and includes it for one recipe", () => {
		expect(loadRecipes().every((r) => r.body === undefined)).toBe(true);
		const one = getRecipe("recipe.search.structural");
		expect(one?.body).toContain("Coverage you must read");
		expect(v.Recipe(one)).toBe(true);
	});

	it("hashes the exact file bytes, so an edited recipe changes the hash", () => {
		const recipe = getRecipe("recipe.search.literal");
		const bytes = readFileSync(
			join(
				import.meta.dirname,
				"../../src/server/guidance/recipes/literal-search.md",
			),
		);
		expect(recipe?.contentHash).toBe(
			createHash("sha256").update(bytes).digest("hex"),
		);
	});

	it("returns null for an unknown recipe instead of an empty recipe", () => {
		expect(getRecipe("recipe.does-not-exist")).toBeNull();
	});
});
