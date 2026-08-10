import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PROJECT } from "../identity.js";
import type { McpServerConfig, McpServerStatus } from "./types.js";

type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type Session = {
  client: Client;
  tools: McpToolInfo[];
  signature: string;
};

export class McpManager {
  private servers: McpServerConfig[] = [];
  private readonly sessions = new Map<string, Session>();

  configure(servers: McpServerConfig[]): void {
    this.servers = servers;
    for (const [id, session] of this.sessions) {
      const server = servers.find((item) => item.id === id && item.enabled);
      if (!server || JSON.stringify(server.transport) !== session.signature) {
        void session.client.close();
        this.sessions.delete(id);
      }
    }
  }

  enabled(): McpServerConfig[] {
    return this.servers.filter((server) => server.enabled);
  }

  async test(server: McpServerConfig): Promise<McpServerStatus> {
    const client = await connect(server);
    try {
      const result = await client.listTools();
      return { connected: true, toolCount: result.tools.length };
    } finally {
      await client.close();
    }
  }

  async search(query: string, serverId?: string): Promise<Array<McpToolInfo & { serverId: string; serverName: string }>> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const servers = this.enabled().filter((server) => !serverId || server.id === serverId);
    const results = await Promise.all(servers.map(async (server) => ({ server, session: await this.session(server) })));
    return results.flatMap(({ server, session }) => session.tools.map((tool) => {
      const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      return { tool, server, score: words.filter((word) => text.includes(word)).length };
    }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ tool, server }) => ({ ...tool, serverId: server.id, serverName: server.name }))
      .slice(0, 12);
  }

  async call(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const server = this.enabled().find((item) => item.id === serverId);
    if (!server) throw new Error(`MCP server is not enabled: ${serverId}`);
    let result;
    try {
      result = await (await this.session(server)).client.callTool({ name: toolName, arguments: args });
    } catch (error) {
      await this.forget(serverId);
      throw error;
    }
    if (result.isError) throw new Error(textContent(result.content) || `MCP tool failed: ${toolName}`);
    const parts = [textContent(result.content)];
    if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
    return parts.filter(Boolean).join("\n\n") || "MCP tool completed without text output.";
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.client.close()));
    this.sessions.clear();
  }

  private async session(server: McpServerConfig): Promise<Session> {
    const cached = this.sessions.get(server.id);
    if (cached) return cached;
    const client = await connect(server);
    try {
      const result = await client.listTools();
      const session: Session = {
        client,
        signature: JSON.stringify(server.transport),
        tools: result.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema as Record<string, unknown>,
        })),
      };
      this.sessions.set(server.id, session);
      return session;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async forget(serverId: string): Promise<void> {
    const session = this.sessions.get(serverId);
    this.sessions.delete(serverId);
    await session?.client.close();
  }
}

async function connect(server: McpServerConfig): Promise<Client> {
  const client = new Client({ name: PROJECT.slug, version: "0.0.0" });
  if (server.transport.type === "stdio") {
    await client.connect(new StdioClientTransport({
      ...server.transport,
      env: { ...getDefaultEnvironment(), ...valueRecord(server.transport.env) },
    }));
    return client;
  }
  const url = new URL(server.transport.url);
  const requestInit = { headers: valueRecord(server.transport.headers) };
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit }));
  } catch {
    await client.close();
    const legacy = new Client({ name: PROJECT.slug, version: "0.0.0" });
    await legacy.connect(new SSEClientTransport(url, { requestInit }));
    return legacy;
  }
  return client;
}

function valueRecord(values: Array<{ name: string; value: string }>): Record<string, string> {
  return Object.fromEntries(values.filter((entry) => entry.name && entry.value).map((entry) => [entry.name, entry.value]));
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") return [block.text];
    if (block.type === "resource_link" && typeof block.uri === "string") return [`Resource: ${block.uri}`];
    if (block.type === "resource" && block.resource && typeof block.resource === "object") {
      const resource = block.resource as Record<string, unknown>;
      if (typeof resource.text === "string") return [resource.text];
      if (typeof resource.uri === "string") return [`Resource: ${resource.uri}`];
    }
    if (block.type === "image" || block.type === "audio") return [`[${block.type} content returned by MCP server]`];
    return [];
  }).join("\n");
}
