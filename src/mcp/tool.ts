import type { Tool } from "../tools/tool.js";
import { objectInput, stringField, ToolInputError } from "../tools/tool.js";
import type { McpManager } from "./manager.js";

export function mcpTool(manager: McpManager): Tool {
  const servers = manager.enabled();
  return {
    name: "mcp",
    description:
      "Find and call tools from configured MCP servers without loading every MCP tool into context. " +
      `Available servers: ${servers.map((server) => `${server.name}${server.description ? ` (${server.description})` : ""}`).join(", ")}. ` +
      "Search first to get the exact tool name and input schema, then call it.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "call"], description: "Required. Search the catalog or call one tool." },
        query: { type: "string", description: "Required for search. Describe the capability needed." },
        server: { type: "string", description: "Optional for search; required for call. MCP server id returned by search." },
        tool: { type: "string", description: "Required for call. Exact MCP tool name returned by search." },
        arguments: { type: "object", description: "Required for call. Arguments matching the schema returned by search." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(_workspace, raw) {
      const input = objectInput(raw);
      const action = stringField(input, "action");
      if (action === "search") {
        const query = stringField(input, "query");
        const server = stringField(input, "server", { optional: true });
        const tools = await manager.search(query!, server);
        return { content: tools.length ? JSON.stringify(tools, null, 2) : "No matching MCP tools found." };
      }
      if (action !== "call") throw new ToolInputError("action must be search or call");
      const server = stringField(input, "server");
      const tool = stringField(input, "tool");
      const args = input.arguments;
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new ToolInputError("arguments must be one JSON object matching the schema returned by MCP search");
      }
      return { content: await manager.call(server!, tool!, args as Record<string, unknown>) };
    },
  };
}
