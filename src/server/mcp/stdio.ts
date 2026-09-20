import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OPERATION_LIMITS } from "../../../core/limits";
import { localIssuer } from "../auth/local-issuer";
import { serverConfig } from "../config";
import { createMcpServer } from "./server";

async function main() {
	if (serverConfig().mode !== "local-demo") {
		throw new Error("Connected stdio identity is not configured");
	}
	const issuer = await localIssuer();
	const server = createMcpServer(issuer.mint);
	await server.connect(
		new StdioServerTransport(process.stdin, process.stdout, {
			maxBufferSize: OPERATION_LIMITS.requestBytes * 2,
		}),
	);
	const shutdown = async () => {
		await server.close();
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}
main().catch(() => {
	console.error(
		"Think-Wide stdio startup failed; check mode, loopback backend and local identity configuration.",
	);
	process.exitCode = 1;
});
