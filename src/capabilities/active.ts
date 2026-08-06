import type { Tool } from "../tools/tool.js";

export type CapabilitySource =
  | { type: "built-in" }
  | { type: "mcp"; serverId: string; pluginId?: string }
  | { type: "plugin"; pluginId: string };

export type ActiveTool = {
  source: CapabilitySource;
  tool: Tool;
};

export type ActiveCapabilities = {
  tools: ActiveTool[];
};

export function activeCapabilities(tools: ActiveTool[]): ActiveCapabilities {
  const names = new Set<string>();
  for (const { tool } of tools) {
    if (names.has(tool.name)) throw new Error(`Active tool name must be unique: ${tool.name}`);
    names.add(tool.name);
  }
  return { tools };
}

export function builtInCapabilities(tools: Tool[]): ActiveCapabilities {
  return activeCapabilities(
    tools.map((tool) => ({ source: { type: "built-in" }, tool })),
  );
}
