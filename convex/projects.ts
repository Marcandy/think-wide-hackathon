import { operation } from "./lib/operation";

export const listProjects = operation.query("listProjects", (ctx, request) =>
	ctx.sources.projects(request),
);
