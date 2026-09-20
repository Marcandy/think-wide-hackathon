import { internalMutation } from "./_generated/server";
import { operation } from "./lib/operation";
import { cacheHistory, registerSnapshot } from "./lib/source_registration";

export const browseSnapshot = operation.query(
	"browseSnapshot",
	(ctx, request) => ctx.sources.browse(request),
);

// Internal ingestion only. A caller identity cannot be supplied in the payload.
export const register = internalMutation({ handler: registerSnapshot });

export const readHistory = operation.query("readHistory", (ctx, request) =>
	ctx.sources.history(request),
);
export const putHistory = internalMutation({ handler: cacheHistory });
