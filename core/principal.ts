export type Principal = Readonly<{ id: string }>;

/** Input is supplied exclusively by the verified Convex auth boundary. */
export function principalFromIdentity(
	identity: { tokenIdentifier: string } | null,
): Principal | null {
	return identity?.tokenIdentifier ? { id: identity.tokenIdentifier } : null;
}
