export type McpTransport =
  | { type: "stdio"; command: string; args: string[]; cwd?: string; env: McpValue[] }
  | { type: "http"; url: string; headers: McpValue[] };

export type McpValue = {
  id: string;
  name: string;
  value: string;
  secret: boolean;
  hasValue?: boolean;
};

export type McpServerConfig = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transport: McpTransport;
};

export type McpServerStatus = {
  connected: boolean;
  toolCount: number;
  error?: string;
};

export function mcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const input = item as Record<string, unknown>;
    const transport = parseTransport(input.transport);
    if (
      typeof input.id !== "string" || !input.id ||
      typeof input.name !== "string" || !input.name ||
      !transport
    ) return [];
    return [{
      id: input.id,
      name: input.name,
      description: typeof input.description === "string" ? input.description : "",
      enabled: input.enabled !== false,
      transport,
    }];
  });
}

function parseTransport(value: unknown): McpTransport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (input.type === "http" && typeof input.url === "string" && input.url) {
    try {
      const url = new URL(input.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return { type: "http", url: url.href, headers: parseValues(input.headers) };
      }
    } catch { /* invalid URL */ }
  }
  if (input.type === "stdio" && typeof input.command === "string" && input.command) {
    return {
      type: "stdio",
      command: input.command,
      args: Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === "string") : [],
      ...(typeof input.cwd === "string" && input.cwd ? { cwd: input.cwd } : {}),
      env: parseValues(input.env),
    };
  }
  return undefined;
}

function parseValues(value: unknown): McpValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || !input.name.trim()) return [];
    return [{
      id: typeof input.id === "string" && input.id ? input.id : `${index}-${input.name}`,
      name: input.name.trim(),
      value: typeof input.value === "string" ? input.value : "",
      secret: input.secret === true,
      hasValue: input.hasValue === true,
    }];
  });
}
