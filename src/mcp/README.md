# MCP

MCP servers are configured here and exposed lazily through one `mcp` broker tool.
The model searches the cached catalogs only when it needs an external capability,
then calls the selected tool through the same broker. This keeps large MCP tool
collections out of every model request.

## Start here

- `types.ts` owns the small persisted server configuration.
- `import.ts` parses supported external configuration shapes into review drafts.
- `manager.ts` owns transports, negotiated connections, catalogs, and execution.
- `tool.ts` adapts the manager to Snaffle's ordinary tool interface.

## Behavior and invariants

Local servers may receive environment variables; remote servers may receive
arbitrary HTTP headers. Individual values can be marked secret, which stores
them through the same protected desktop-secret path used by provider keys and
redacts them before state reaches the renderer. This covers API-key and bearer
token authentication without coupling MCP configuration to any one vendor.

The settings UI imports the common Claude/Cursor `mcpServers` and VS Code
`servers` JSON shapes, plus a bare single-server object. Importing only creates
an editable review draft: placeholder credentials are cleared and likely keys,
tokens, secrets, and authorization values are marked for protected storage.
When copied JSON omits authentication, add the environment variable or HTTP
header documented by that server in the review form before testing it.

Connections and tool discovery time out after 30 seconds. Tool execution times
out after three minutes. A failed transport session is discarded so the next
call reconnects instead of reusing a broken client. Local-command MCP servers
are host processes and do not inherit the workspace shell sandbox.

Interactive OAuth is deliberately a later transport feature. It needs a browser
callback and token refresh lifecycle rather than another text field.

MCP enters through `capabilities/`; the agent loop has no MCP-specific path.
