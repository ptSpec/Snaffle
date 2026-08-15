import { ipcMain } from "electron";
import type { DesktopState } from "../api.js";
import type { McpManager } from "../../mcp/manager.js";
import { mcpServers, type McpServerConfig } from "../../mcp/types.js";
import { preserveMcpSecrets } from "../mcp-secrets.js";

export function registerMcpIpc({
  manager,
  enabled,
  setEnabled,
  servers,
  update,
  state,
}: {
  manager: McpManager;
  enabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  servers: () => McpServerConfig[];
  update: (servers: McpServerConfig[]) => void;
  state: (includeConversation?: boolean) => Promise<DesktopState>;
}): void {
  ipcMain.handle("desktop:set-mcp-enabled", async (_event, value: unknown) => {
    if (typeof value !== "boolean") throw new Error("MCP enabled state must be true or false");
    if (value !== enabled()) setEnabled(value);
    return state(false);
  });

  ipcMain.handle("desktop:save-mcp-server", async (_event, value: unknown) => {
    const parsed = parseServer(value);
    const server = preserveMcpSecrets(parsed, servers().find((item) => item.id === parsed.id));
    const next = [...servers().filter((item) => item.id !== server.id), server];
    manager.configure(next);
    update(next);
    return state(false);
  });

  ipcMain.handle("desktop:remove-mcp-server", async (_event, value: unknown) => {
    if (typeof value !== "string" || !value) throw new Error("MCP server id must be text");
    const next = servers().filter((server) => server.id !== value);
    manager.configure(next);
    update(next);
    return state(false);
  });

  ipcMain.handle("desktop:test-mcp-server", (_event, value: unknown) => {
    const parsed = parseServer(value);
    return manager.test(preserveMcpSecrets(parsed, servers().find((item) => item.id === parsed.id)));
  });
}

function parseServer(value: unknown): McpServerConfig {
  const [server] = mcpServers([value]);
  if (!server) throw new Error("MCP server configuration is incomplete");
  return server;
}
