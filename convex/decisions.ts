import { decisionRevision } from "../core";
import { operation } from "./lib/operation";

export const recordDecision = operation.mutation(
	"recordDecision",
	async (ctx, request) => ({
		resultKind: "decision",
		resultId: await ctx.appendDecision({
			investigationId: request.investigationId,
			kind: request.kind,
			// Decision 0003: a chosen category is stored as given; absent stays absent.
			...(request.category === undefined ? {} : { category: request.category }),
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
