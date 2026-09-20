import { decisionRevision } from "../core";
import { operation } from "./lib/operation";

export const recordDecision = operation.mutation(
	"recordDecision",
	async (ctx, request) => ({
		resultKind: "decision",
		resultId: await ctx.appendDecision({
			investigationId: request.investigationId,
			kind: request.kind,
			statement: request.statement,
			...(request.targetFindingId === undefined
				? {}
				: { targetFindingId: request.targetFindingId }),
			...(request.refs === undefined ? {} : { refs: request.refs }),
			madeAtRevision: request.expectedRevision,
			resultingRevision: decisionRevision(
				request.kind,
				request.expectedRevision,
			),
			createdAt: Date.now(),
		}),
	}),
);
