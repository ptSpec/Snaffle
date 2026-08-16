import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PROJECT } from "../identity.js";
import type { McpServerConfig, McpServerStatus } from "./types.js";

const CONNECTION_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_MS = 180_000;

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

  serverName(serverId: string): string | undefined {
    return this.servers.find((server) => server.id === serverId)?.name;
  }

  async test(server: McpServerConfig): Promise<McpServerStatus> {
    const client = await connect(server);
    try {
      const result = await withTimeout(
        client.listTools(),
        CONNECTION_TIMEOUT_MS,
        `${server.name} tool discovery`,
      );
      return { connected: true, toolCount: result.tools.length };
    } finally {
      await client.close();
    }
  }

  async search(query: string, serverId?: string, signal?: AbortSignal): Promise<Array<McpToolInfo & { serverId: string; serverName: string }>> {
    signal?.throwIfAborted();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const servers = this.enabled().filter((server) => !serverId || server.id === serverId);
    const results = await Promise.all(servers.map(async (server) => ({ server, session: await this.session(server, signal) })));
    return results.flatMap(({ server, session }) => session.tools.map((tool) => {
      const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      return { tool, server, score: words.filter((word) => text.includes(word)).length };
    }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ tool, server }) => ({ ...tool, serverId: server.id, serverName: server.name }))
      .slice(0, 12);
  }

  async call(serverId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: string; serverName: string }> {
    const server = this.enabled().find((item) => item.id === serverId);
    if (!server) throw new Error(`MCP server is not enabled: ${serverId}`);
    let result;
    try {
      result = await withTimeout(
        (await this.session(server, signal)).client.callTool({ name: toolName, arguments: args }),
        TOOL_TIMEOUT_MS,
        `${server.name}.${toolName}`,
        signal,
      );
    } catch (error) {
      await this.forget(serverId);
      throw new Error(
        `MCP call failed for ${server.name}.${toolName}. The connection was reset and will reconnect on the next call. ${errorMessage(error)}`,
      );
    }
    if (result.isError) throw new Error(textContent(result.content) || `MCP tool failed: ${toolName}`);
    const parts = [textContent(result.content)];
    if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
    return {
      content: parts.filter(Boolean).join("\n\n") || "MCP tool completed without text output.",
      serverName: server.name,
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.client.close()));
    this.sessions.clear();
  }

  private async session(server: McpServerConfig, signal?: AbortSignal): Promise<Session> {
    signal?.throwIfAborted();
    const cached = this.sessions.get(server.id);
    if (cached) return cached;
    const client = await connect(server);
    try {
      const result = await withTimeout(
        client.listTools(),
        CONNECTION_TIMEOUT_MS,
        `${server.name} tool discovery`,
        signal,
      );
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
    try {
      await withTimeout(client.connect(new StdioClientTransport({
        ...server.transport,
        env: { ...getDefaultEnvironment(), ...valueRecord(server.transport.env) },
      })), CONNECTION_TIMEOUT_MS, `${server.name} connection`);
      return client;
    } catch (error) {
      await client.close();
      throw new Error(`Could not connect to MCP server ${server.name}. ${errorMessage(error)}`);
    }
  }
  const url = new URL(server.transport.url);
  const requestInit = { headers: valueRecord(server.transport.headers) };
  try {
    await withTimeout(
      client.connect(new StreamableHTTPClientTransport(url, { requestInit })),
      CONNECTION_TIMEOUT_MS,
      `${server.name} connection`,
    );
  } catch {
    await client.close();
    const legacy = new Client({ name: PROJECT.slug, version: "0.0.0" });
    try {
      await withTimeout(
        legacy.connect(new SSEClientTransport(url, { requestInit })),
        CONNECTION_TIMEOUT_MS,
        `${server.name} legacy SSE connection`,
      );
      return legacy;
    } catch (error) {
      await legacy.close();
      throw new Error(`Could not connect to MCP server ${server.name}. ${errorMessage(error)}`);
    }
  }
  return client;
}

function valueRecord(values: Array<{ name: string; value: string }>): Record<string, string> {
  return Object.fromEntries(values.filter((entry) => entry.name && entry.value).map((entry) => [entry.name, entry.value]));
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds / 1000} seconds`)), milliseconds);
  });
  const cancellation = new Promise<never>((_, reject) => {
    if (!signal) return;
    aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
  });
  try {
    return await Promise.race([promise, timeout, cancellation]);
  } finally {
    if (timer) clearTimeout(timer);
    if (aborted) signal?.removeEventListener("abort", aborted);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
