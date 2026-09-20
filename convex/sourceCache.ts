import { internalMutation } from "./_generated/server";
import { operation } from "./lib/operation";
import { cacheSource } from "./lib/source_registration";

export const readSource = operation.query("readSource", (ctx, request) =>
	ctx.sources.read(request),
);
export const put = internalMutation({ handler: cacheSource });
