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

test("protected database access and public registration are confined to convex/lib", () => {
	const violations: string[] = [];
	for (const path of sourceFiles("convex")) {
		if (relative("convex", path).startsWith("lib/")) continue;
		const source = ts.createSourceFile(
			path,
			readFileSync(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		function visit(node: ts.Node) {
			// Reject access, bracket notation and destructuring, including aliased contexts.
			if (
				(ts.isIdentifier(node) && node.text === "db") ||
				(ts.isStringLiteral(node) && node.text === "db")
			)
				violations.push(`${path}: raw database access`);
			if (
				ts.isImportDeclaration(node) &&
				node.importClause?.namedBindings &&
				ts.isNamedImports(node.importClause.namedBindings)
			) {
				for (const element of node.importClause.namedBindings.elements)
					if (
						[
							"query",
							"mutation",
							"action",
							"queryGeneric",
							"mutationGeneric",
							"actionGeneric",
						].includes((element.propertyName ?? element.name).text)
					)
						violations.push(
							`${path}: public registration bypasses operation wrapper`,
						);
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	expect(violations).toEqual([]);
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
