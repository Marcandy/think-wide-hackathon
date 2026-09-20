import { operation } from "./lib/operation";

export const openInvestigation = operation.mutation(
	"openInvestigation",
	async (ctx, request) => ({
		resultKind: "investigation",
		resultId: await ctx.createInvestigation({
			question: request.question,
			snapshotIds: request.snapshotIds,
			revision: 0,
			status: "open",
			createdAt: Date.now(),
		}),
	}),
);

export const readInvestigation = operation.query(
	"readInvestigation",
	(ctx, request) => ctx.readInvestigation(request),
);
