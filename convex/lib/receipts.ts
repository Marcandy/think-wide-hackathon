import { argumentDigest, compareReceipt, type Principal } from "../../core";
import type { OperationId } from "../../generated/operations";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./validation";

export type ResultId = Pick<Doc<"receipts">, "resultKind" | "resultId">;

/** The indexed read reserves the key through Convex transaction conflict detection.
 * There is no observable pending receipt: business writes and finalization commit together.
 */
export async function reserveReceipt(
	ctx: MutationCtx,
	principal: Principal,
	operationId: OperationId,
	requestKey: string,
	request: unknown,
) {
	const digest = await argumentDigest(request);
	const previous = await ctx.db
		.query("receipts")
		.withIndex("by_principal_operation_key", (q) =>
			q
				.eq("principal", principal.id)
				.eq("operationId", operationId)
				.eq("requestKey", requestKey),
		)
		.unique();
	return {
		previous,
		compare() {
			if (compareReceipt(previous?.digest, digest) === "conflict")
				fail(
					"request_key_conflict",
					"Request key already used with different arguments",
				);
		},
		async finalize(result: ResultId) {
			await ctx.db.insert("receipts", {
				principal: principal.id,
				operationId,
				requestKey,
				digest,
				...result,
			});
		},
	};
}
