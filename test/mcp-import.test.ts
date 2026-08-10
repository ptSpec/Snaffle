import assert from "node:assert/strict";
import test from "node:test";
import { importMcpConfig } from "../src/mcp/import.js";

test("imports Claude-style stdio configuration without saving documentation placeholders", () => {
  const { servers } = importMcpConfig(JSON.stringify({
    mcpServers: {
      MiniMax: {
        command: "uvx",
        args: ["minimax-mcp"],
        env: {
          MINIMAX_API_KEY: "Enter your API Key",
          MINIMAX_MCP_BASE_PATH: "Local output directory path, e.g., /User/xxx/Desktop",
          MINIMAX_API_HOST: "https://api.minimax.io",
        },
        transport: "Optional: stdio or SSE",
      },
    },
  }));

  assert.equal(servers.length, 1);
  assert.equal(servers[0]?.name, "MiniMax");
  assert.equal(servers[0]?.transport.type, "stdio");
  if (servers[0]?.transport.type !== "stdio") return;
  assert.equal(servers[0].transport.command, "uvx");
  assert.deepEqual(servers[0].transport.args, ["minimax-mcp"]);
  assert.deepEqual(servers[0].transport.env.map(({ name, value, secret }) => ({ name, value, secret })), [
    { name: "MINIMAX_API_KEY", value: "", secret: true },
    { name: "MINIMAX_MCP_BASE_PATH", value: "", secret: false },
    { name: "MINIMAX_API_HOST", value: "https://api.minimax.io", secret: false },
  ]);
});

test("imports VS Code HTTP configuration and input secrets", () => {
  const { servers } = importMcpConfig(JSON.stringify({
    inputs: [{ id: "token", type: "promptString", password: true }],
    servers: {
      Search: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${input:token}" },
      },
    },
  }));

  assert.equal(servers[0]?.transport.type, "http");
  if (servers[0]?.transport.type !== "http") return;
  assert.equal(servers[0].transport.url, "https://example.com/mcp");
  assert.equal(servers[0].transport.headers[0]?.name, "Authorization");
  assert.equal(servers[0].transport.headers[0]?.value, "");
  assert.equal(servers[0].transport.headers[0]?.secret, true);
});
