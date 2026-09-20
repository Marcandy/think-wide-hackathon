export function serverConfig(env: NodeJS.ProcessEnv = process.env) {
	const mode = env.THINK_WIDE_MODE;
	if (mode !== "local-demo" && mode !== "connected") {
		throw new Error(
			"THINK_WIDE_MODE must be explicitly local-demo or connected",
		);
	}
	if (
		env.NODE_ENV === "production" &&
		(mode === "local-demo" || env.THINKWIDE_ALLOW_UNISOLATED_ANALYZER === "1")
	) {
		throw new Error("Production refuses local-demo and unisolated analysis");
	}
	const convexUrl = env.CONVEX_SELF_HOSTED_URL ?? env.CONVEX_URL;
	if (!convexUrl) {
		throw new Error("A Convex URL is required");
	}
	const url = new URL(convexUrl);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	) {
		throw new Error("Invalid Convex origin");
	}
	if (
		mode === "local-demo" &&
		(url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname))
	) {
		throw new Error("Local identity requires a literal loopback Convex origin");
	}
	if (mode === "connected" && url.protocol !== "https:") {
		throw new Error("Connected identity requires HTTPS");
	}
	return { mode, convexUrl: url.origin };
}
