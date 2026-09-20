import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOLS } from "../../../generated/mcp-tools";
import { CONTRACT_VERSION } from "../../../generated/operations";
import { OperationError } from "../../../generated/validators.js";
import { dispatch } from "../ops/dispatch";

/** Low-level SDK registration preserves the generated JSON Schemas verbatim;
 * the high-level registerTool API requires another authored Zod shape. */
export function createMcpServer(
	token: () => Promise<string>,
) {
	const server = new Server(
		{ name: "think-wide", version: CONTRACT_VERSION },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: structuredClone(MCP_TOOLS),
	}));
	server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
		const tool = MCP_TOOLS.find((item) => item.name === params.name);
		const response = tool
			? await dispatch(tool.operationId, params.arguments ?? {}, await token())
			: { code: "capability_disabled", message: "Operation unavailable" };
		const isError = OperationError(response);
		if (!response || typeof response !== "object" || Array.isArray(response)) {
			throw new Error("Invalid operation result");
		}
		return {
			isError,
			structuredContent: { ...response },
			content: [
				{
					type: "text",
					text: isError
						? JSON.stringify(response)
						: "Result available in structuredContent.",
				},
			],
		};
	});
	return server;
}
