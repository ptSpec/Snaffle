import type { McpServerConfig, McpTransport, McpValue } from "../mcp/types.js";
import { decodeSecret, encodeSecret } from "./settings.js";

export function loadMcpSecrets(servers: McpServerConfig[]): McpServerConfig[] {
  return mapValues(servers, (entry) => {
    if (!entry.secret) return entry;
    const value = decodeSecret(entry.value);
    return { ...entry, value, hasValue: Boolean(value) };
  });
}

export function storeMcpSecrets(servers: McpServerConfig[]): McpServerConfig[] {
  return mapValues(servers, (entry) => entry.secret && entry.value
    ? { ...entry, value: encodeSecret(entry.value), hasValue: true }
    : entry);
}

export function publicMcpServers(servers: McpServerConfig[]): McpServerConfig[] {
  return mapValues(servers, (entry) => entry.secret
    ? { ...entry, value: "", hasValue: Boolean(entry.value) }
    : entry);
}

export function preserveMcpSecrets(
  server: McpServerConfig,
  existing: McpServerConfig | undefined,
): McpServerConfig {
  const saved = new Map(values(existing?.transport).map((entry) => [entry.id, entry]));
  return mapServer(server, (entry) => {
    if (!entry.secret || entry.value || !entry.hasValue) return entry;
    return { ...entry, value: saved.get(entry.id)?.value ?? "" };
  });
}

function mapValues(
  servers: McpServerConfig[],
  change: (entry: McpValue) => McpValue,
): McpServerConfig[] {
  return servers.map((server) => mapServer(server, change));
}

function mapServer(server: McpServerConfig, change: (entry: McpValue) => McpValue): McpServerConfig {
  const transport: McpTransport = server.transport.type === "stdio"
    ? { ...server.transport, env: server.transport.env.map(change) }
    : { ...server.transport, headers: server.transport.headers.map(change) };
  return { ...server, transport };
}

function values(transport: McpTransport | undefined): McpValue[] {
  if (!transport) return [];
  return transport.type === "stdio" ? transport.env : transport.headers;
}
