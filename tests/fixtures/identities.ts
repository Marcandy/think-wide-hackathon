/**
 * T04 — principals A and B in separate workspaces, with independent grants (issue #4).
 *
 * This file describes WHO EXISTS and WHAT THEY HOLD. It states no outcome and contains
 * no decision function; the expectations live in tests/fixtures/expectations.ts and the
 * real policy does the deciding. A fixture that could answer "allowed?" would be exactly
 * the mock the ticket forbids.
 *
 * Domain checks must use verified identity, never a request-body actor field, so each
 * principal carries a token subject, issuer and audience rather than a role string.
 */

export type PrincipalId = "principal-a" | "principal-b";

export type WorkspaceId = "ws_fixture_alpha" | "ws_fixture_beta";

export type Principal = {
	readonly id: PrincipalId;
	/** Token subject. The verified identity, not a claim in the request body. */
	readonly subject: string;
	readonly issuer: string;
	readonly audience: string;
	readonly workspace: WorkspaceId;
	readonly displayName: string;
};

export type Scope = "read:tree" | "read:bytes" | "read:investigation";

export type Grant = {
	readonly grantId: string;
	readonly principal: PrincipalId;
	readonly workspace: WorkspaceId;
	readonly sourceId: string;
	readonly investigationId: string;
	/** Grant epoch; a run admitted under an older epoch must not survive a change. */
	readonly epoch: number;
	readonly notAfterMs: number;
	readonly scopes: readonly Scope[];
};

/** Fixed clock, so the expired-grant case is expired deterministically, not by wall time. */
export const FIXTURE_NOW_MS = Date.UTC(2026, 8, 20, 16, 0, 0);
const ONE_HOUR = 60 * 60 * 1000;

export const TRUSTED_ISSUER = "https://fixture-issuer.invalid/";
export const EXPECTED_AUDIENCE = "think-wide-fixture";

export const WORKSPACE_A: WorkspaceId = "ws_fixture_alpha";
export const WORKSPACE_B: WorkspaceId = "ws_fixture_beta";

export const PRINCIPAL_A: Principal = Object.freeze({
	id: "principal-a",
	subject: "user_fixture_A",
	issuer: TRUSTED_ISSUER,
	audience: EXPECTED_AUDIENCE,
	workspace: WORKSPACE_A,
	displayName: "Fixture Principal A",
});

export const PRINCIPAL_B: Principal = Object.freeze({
	id: "principal-b",
	subject: "user_fixture_B",
	issuer: TRUSTED_ISSUER,
	audience: EXPECTED_AUDIENCE,
	workspace: WORKSPACE_B,
	displayName: "Fixture Principal B",
});

export const PRINCIPALS: readonly Principal[] = Object.freeze([
	PRINCIPAL_A,
	PRINCIPAL_B,
]);

/**
 * A and B own disjoint sources and investigations in disjoint workspaces. The source
 * IDs line up with the two synthetic fixture repos in tests/fixtures/repos/.
 */
export const SOURCE_A = "src_fixture_alpha";
export const SOURCE_B = "src_fixture_beta";
export const INVESTIGATION_A = "inv_fixture_alpha";
export const INVESTIGATION_B = "inv_fixture_beta";
export const SOURCE_A_EXPIRED = "src_fixture_alpha_expired";
export const INVESTIGATION_A_EXPIRED = "inv_fixture_alpha_expired";

export const GRANT_A: Grant = Object.freeze({
	grantId: "grant_A_current",
	principal: "principal-a",
	workspace: WORKSPACE_A,
	sourceId: SOURCE_A,
	investigationId: INVESTIGATION_A,
	epoch: 1,
	notAfterMs: FIXTURE_NOW_MS + ONE_HOUR,
	scopes: Object.freeze([
		"read:tree",
		"read:bytes",
		"read:investigation",
	] as const),
});

export const GRANT_B: Grant = Object.freeze({
	grantId: "grant_B_current",
	principal: "principal-b",
	workspace: WORKSPACE_B,
	sourceId: SOURCE_B,
	investigationId: INVESTIGATION_B,
	epoch: 1,
	notAfterMs: FIXTURE_NOW_MS + ONE_HOUR,
	scopes: Object.freeze([
		"read:tree",
		"read:bytes",
		"read:investigation",
	] as const),
});

/** Same shape as a live grant, but already past. Expiry must fail closed. */
export const GRANT_A_EXPIRED: Grant = Object.freeze({
	grantId: "grant_A_expired",
	principal: "principal-a",
	workspace: WORKSPACE_A,
	sourceId: SOURCE_A_EXPIRED,
	investigationId: INVESTIGATION_A_EXPIRED,
	epoch: 1,
	notAfterMs: FIXTURE_NOW_MS - ONE_HOUR,
	scopes: Object.freeze([
		"read:tree",
		"read:bytes",
		"read:investigation",
	] as const),
});

export const GRANTS: readonly Grant[] = Object.freeze([
	GRANT_A,
	GRANT_B,
	GRANT_A_EXPIRED,
]);

export function grantsFor(principal: PrincipalId): readonly Grant[] {
	return GRANTS.filter((g) => g.principal === principal);
}

export function principalById(id: PrincipalId): Principal {
	const found = PRINCIPALS.find((p) => p.id === id);
	if (!found) throw new Error(`unknown fixture principal: ${id}`);
	return found;
}
