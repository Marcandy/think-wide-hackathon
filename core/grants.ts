import type { OperationId } from "../generated/operations";
import type { Principal } from "./principal";

export type ResourceKind =
	| "investigation"
	| "decision"
	| "run"
	| "snapshot"
	| "repository"
	| "entry"
	| "finding";
export type Resource = Readonly<{ kind: ResourceKind; id: string }>;
export type Grant = Readonly<{
	principal: string;
	resourceKind: ResourceKind;
	resourceId: string;
	actions: readonly string[];
	epoch: number;
	revokedAt?: number;
}>;

export function may(
	principal: Principal,
	action: OperationId,
	resource: Resource,
	grants: readonly Grant[],
): "allow" | "deny" {
	return grants.some(
		(grant) =>
			grant.principal === principal.id &&
			grant.resourceKind === resource.kind &&
			grant.resourceId === resource.id &&
			grant.revokedAt === undefined &&
			grant.actions.includes(action),
	)
		? "allow"
		: "deny";
}
