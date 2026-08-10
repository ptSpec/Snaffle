import type { McpServerConfig, McpValue } from "./types.js";

type JsonObject = Record<string, unknown>;

export type McpImport = {
  servers: McpServerConfig[];
  warnings: string[];
};

export function importMcpConfig(text: string): McpImport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("MCP configuration must be valid JSON");
  }
  if (!isObject(value)) throw new Error("MCP configuration must be one JSON object");

  const inputs = inputDefinitions(value.inputs);
  const entries = serverEntries(value);
  if (!entries.length) {
    throw new Error('Expected "mcpServers", "servers", or one server with a command or URL');
  }

  const warnings: string[] = [];
  const servers = entries.map(([name, server]) => importServer(name, server, inputs, warnings));
  return { servers, warnings };
}

function serverEntries(value: JsonObject): Array<[string, JsonObject]> {
  for (const key of ["mcpServers", "servers"]) {
    if (isObject(value[key])) {
      return Object.entries(value[key]).flatMap(([name, server]) => isObject(server) ? [[name, server]] : []);
    }
  }
  return typeof value.command === "string" || typeof value.url === "string"
    ? [[typeof value.name === "string" && value.name ? value.name : "MCP server", value]]
    : [];
}

function importServer(
  name: string,
  value: JsonObject,
  inputs: Map<string, { secret: boolean; description: string }>,
  warnings: string[],
): McpServerConfig {
  const description = typeof value.description === "string" ? value.description : "";
  const common = { id: crypto.randomUUID(), name, description, enabled: value.disabled !== true };

  if (typeof value.command === "string" && value.command.trim()) {
    return {
      ...common,
      transport: {
        type: "stdio",
        command: value.command.trim(),
        args: Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === "string") : [],
        ...(typeof value.cwd === "string" && value.cwd ? { cwd: value.cwd } : {}),
        env: importValues(value.env, inputs),
      },
    };
  }

  if (typeof value.url === "string" && value.url.trim()) {
    if (/\$\{[^}]+\}/.test(value.url)) warnings.push(`${name}: fill URL variables before testing the connection.`);
    return {
      ...common,
      transport: {
        type: "http",
        url: value.url.trim(),
        headers: importValues(value.headers, inputs),
      },
    };
  }

  throw new Error(`${name} needs either a command or URL`);
}

function importValues(value: unknown, inputs: Map<string, { secret: boolean; description: string }>): McpValue[] {
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([name, raw]) => {
    if (typeof raw !== "string") return [];
    const inputId = /\$\{input:([^}]+)\}/.exec(raw)?.[1];
    const input = inputId ? inputs.get(inputId) : undefined;
    const secret = input?.secret === true || secretName(name);
    return [{
      id: crypto.randomUUID(),
      name,
      value: importedValue(raw),
      secret,
    }];
  });
}

function importedValue(value: string): string {
  const environment = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-([^}]*))?\}$/.exec(value);
  if (environment) return environment[1] ?? "";
  if (/\$\{input:[^}]+\}/.test(value)) return "";
  if (/^(?:enter|insert|replace|your)[ _-]*(?:your[ _-]*)?(?:api[ _-]*)?(?:key|token|secret|password)/i.test(value)) return "";
  if (/^optional(?:\.|:|\s)/i.test(value) || /^local\b.*\bpath\b.*\be\.g\b/i.test(value)) return "";
  return value;
}

function secretName(name: string): boolean {
  return /(?:^|_)(?:api_?)?(?:key|token|secret|password|authorization|auth)(?:$|_)/i.test(name);
}

function inputDefinitions(value: unknown): Map<string, { secret: boolean; description: string }> {
  const result = new Map<string, { secret: boolean; description: string }>();
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    if (!isObject(entry) || typeof entry.id !== "string") continue;
    result.set(entry.id, {
      secret: entry.password === true,
      description: typeof entry.description === "string" ? entry.description : "",
    });
  }
  return result;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
