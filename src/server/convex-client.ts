import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { serverConfig } from "./config";

/** A fresh client per request; no authenticated singleton or admin credential. */
export function convexClient(token: string) {
	const client = new ConvexHttpClient(serverConfig().convexUrl, {
		logger: false,
		fetch: async (input, init) => {
			const response = await fetch(input, { ...init, redirect: "error" });
			if (response.status === 401) {
				throw new ConvexError({
					code: "unauthenticated",
					message: "Authentication required",
				});
			}
			return response;
		},
	});
	client.setAuth(token);
	return client;
}
