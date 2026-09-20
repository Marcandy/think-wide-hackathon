import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { OPERATIONS } from "../../generated/operations";
import { serverConfig } from "../../src/server/config";

const base = { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210" };
describe("T08 startup boundary", () => {
	test.each([
		undefined,
		"",
		"unknown",
	])("requires explicit valid mode %s", (mode) => {
		expect(() => serverConfig({ ...base, THINK_WIDE_MODE: mode })).toThrow();
	});
	test("refuses local-demo in production", () => {
		expect(() =>
			serverConfig({
				...base,
				THINK_WIDE_MODE: "local-demo",
				NODE_ENV: "production",
			}),
		).toThrow();
	});
	test("refuses unisolated analyzer in connected production", () => {
		expect(() =>
			serverConfig({
				THINK_WIDE_MODE: "connected",
				CONVEX_URL: "https://example.convex.cloud",
				NODE_ENV: "production",
				THINKWIDE_ALLOW_UNISOLATED_ANALYZER: "1",
			}),
		).toThrow();
	});
	test.each([
		"http://localhost:3210",
		"http://127.0.0.1.evil:3210",
		"https://example.com",
		"http://0.0.0.0:3210",
		"http://user@127.0.0.1:3210",
	])("refuses nonliteral loopback or credentials %s", (url) => {
		expect(() =>
			serverConfig({ THINK_WIDE_MODE: "local-demo", CONVEX_URL: url }),
		).toThrow();
	});
	test("connected config does not imply a local identity", () => {
		expect(
			serverConfig({
				THINK_WIDE_MODE: "connected",
				CONVEX_URL: "https://example.convex.cloud",
			}).mode,
		).toBe("connected");
	});
});

test("adapters never restate registry facts or import privileged backend code", () => {
	const forbidden = new Set<string>(
		OPERATIONS.flatMap((op) => [
			op.operationId,
			op.summary,
			op.request,
			op.response,
			...("handler" in op ? [op.handler] : []),
		]),
	);
	for (const dir of ["src/server/mcp", "src/server/ops"]) {
		for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
			const source = readFileSync(`${dir}/${name}`, "utf8");
			const file = ts.createSourceFile(
				name,
				source,
				ts.ScriptTarget.Latest,
				true,
			);
			function visit(node: ts.Node) {
				if (ts.isStringLiteralLike(node)) {
					expect(
						forbidden.has(node.text),
						`${name}: restated ${node.text}`,
					).toBe(false);
				}
				if (
					ts.isPropertyAssignment(node) &&
					["inputSchema", "description", "exposure", "effect"].includes(
						node.name.getText(file),
					)
				) {
					throw new Error(`${name}: hand-authored registry property`);
				}
				ts.forEachChild(node, visit);
			}
			visit(file);
			expect(source).not.toMatch(/ADMIN_KEY|setAdminAuth|convex\/lib/);
		}
	}
});

// These are real jose signatures and verification, not mocked identity claims.
test("local issuer uses a persistent private key and short-lived audience-bound tokens", async () => {
	const { localIssuer, LOCAL_ISSUER, LOCAL_AUDIENCE } = await import(
		"../../src/server/auth/local-issuer"
	);
	const { createLocalJWKSet, jwtVerify } = await import("jose");
	const { vi } = await import("vitest");
	vi.stubEnv("THINK_WIDE_MODE", "local-demo");
	vi.stubEnv("CONVEX_SELF_HOSTED_URL", "http://127.0.0.1:3210");
	try {
		const issuer = await localIssuer();
		const reopened = await localIssuer();
		expect(reopened.jwksDataUri).toBe(issuer.jwksDataUri);
		const publicKeys = JSON.parse(
			Buffer.from(issuer.jwksDataUri.split(",")[1], "base64").toString(),
		);
		expect(publicKeys.keys[0]).not.toHaveProperty("d");
		const token = await issuer.mint();
		const resolver = createLocalJWKSet(publicKeys);
		const { payload, protectedHeader } = await jwtVerify(token, resolver, {
			issuer: LOCAL_ISSUER,
			audience: LOCAL_AUDIENCE,
			algorithms: ["RS256"],
		});
		expect(payload.sub).toBe("local-developer");
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
		expect(protectedHeader.typ).toBe("JWT");
		await expect(
			jwtVerify(token, resolver, { audience: "foreign-audience" }),
		).rejects.toThrow();
		await expect(
			jwtVerify(token, resolver, {
				currentDate: new Date(((payload.exp ?? 0) + 1) * 1000),
			}),
		).rejects.toThrow();
		vi.stubEnv("NODE_ENV", "production");
		await expect(localIssuer()).rejects.toThrow();
		vi.stubEnv("NODE_ENV", "test");
		vi.stubEnv("THINK_WIDE_MODE", "connected");
		vi.stubEnv("CONVEX_SELF_HOSTED_URL", "https://example.convex.cloud");
		await expect(localIssuer()).rejects.toThrow();
	} finally {
		vi.unstubAllEnvs();
	}
});
