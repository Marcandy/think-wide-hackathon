import { OPERATIONS, type OperationId } from "../generated/operations";
import type { Principal } from "./principal";

export type ResourceKind = "investigation" | "snapshot";
export type Resource = Readonly<{ kind: ResourceKind; id: string }>;
export type Grant = Readonly<{
	principal: string;
	resourceKind: ResourceKind;
	resourceId: string;
	role: "owner" | "reader";
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
			(grant.role === "owner" ||
				(grant.role === "reader" &&
					// Snapshots are immutable inputs; state effects modify investigations.
					(resource.kind === "snapshot" ||
						OPERATIONS.some(
							(operation) =>
								operation.operationId === action && operation.effect === "read",
						)))),
	)
		? "allow"
		: "deny";
}
