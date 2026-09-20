import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "_generated") return [];
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? sourceFiles(path)
			: path.endsWith(".ts")
				? [path]
				: [];
	});
}

function boundaryViolations(text: string, path = "convex/probe.ts"): string[] {
	const violations: string[] = [];
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	function visit(node: ts.Node) {
		// Reject access, bracket notation and destructuring, including aliased contexts.
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			node.text === "db"
		)
			violations.push(`${path}: raw database access`);
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			if (
				/(^|\/)_generated\/server(?:\.[cm]?[jt]s)?$/.test(
					node.moduleSpecifier.text,
				)
			) {
				if (
					!clause ||
					clause.name ||
					!bindings ||
					!ts.isNamedImports(bindings) ||
					bindings.elements.some(
						(element) =>
							!["internalMutation", "internalQuery", "internalAction"].includes(
								(element.propertyName ?? element.name).text,
							),
					)
				)
					violations.push(
						`${path}: public registration bypasses operation wrapper`,
					);
			}
			if (node.moduleSpecifier.text === "convex/server") {
				// Direct generic builders must not bypass the generated-server rule either.
				if (
					clause?.name ||
					!bindings ||
					!ts.isNamedImports(bindings) ||
					bindings.elements.some((element) =>
						[
							"queryGeneric",
							"mutationGeneric",
							"actionGeneric",
							"httpActionGeneric",
						].includes((element.propertyName ?? element.name).text),
					)
				)
					violations.push(
						`${path}: public registration bypasses operation wrapper`,
					);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return violations;
}

test("protected database access and public registration are confined to convex/lib", () => {
	const violations = sourceFiles("convex")
		.filter((path) => !relative("convex", path).startsWith("lib/"))
		.flatMap((path) => boundaryViolations(readFileSync(path, "utf8"), path));
	expect(violations).toEqual([]);
});

test.each([
	'import * as server from "./_generated/server"; server.query({});',
	'import { httpAction } from "./_generated/server"; httpAction(() => {});',
	'import server from "./_generated/server";',
	'import { query as internalQuery } from "./_generated/server";',
	'import { internalMutation, mutation } from "./_generated/server.js";',
	'import "./_generated/server";',
])("registration allowlist rejects bypass: %s", (source) => {
	expect(boundaryViolations(source)).toEqual([
		"convex/probe.ts: public registration bypasses operation wrapper",
	]);
});

test("registration allowlist accepts internal builders including aliases", () => {
	expect(
		boundaryViolations(
			'import { internalMutation, internalQuery as query, internalAction } from "./_generated/server";',
		),
	).toEqual([]);
});

test("core stays pure and Convex cannot import the web app", () => {
	const violations: string[] = [];
	for (const path of [...sourceFiles("core"), ...sourceFiles("convex")]) {
		const source = ts.createSourceFile(
			path,
			readFileSync(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		for (const statement of source.statements) {
			if (
				!ts.isImportDeclaration(statement) &&
				!ts.isExportDeclaration(statement)
			)
				continue;
			const specifier = statement.moduleSpecifier;
			if (!specifier || !ts.isStringLiteral(specifier)) continue;
			if (
				path.startsWith("core/") &&
				!specifier.text.startsWith("./") &&
				!specifier.text.startsWith("../generated/")
			)
				violations.push(path);
			if (specifier.text.includes("src/") || specifier.text.startsWith("#/"))
				violations.push(path);
		}
	}
	expect(violations).toEqual([]);
});
