import { useEffect, useState } from "react";
import { importMcpConfig } from "../../../../mcp/import.js";
import type { McpServerConfig, McpServerStatus, McpValue } from "../../../../mcp/types.js";

const NEW_SERVER = "new";

export function McpSettings({
  servers,
  error,
  onSave,
  onRemove,
  onTest,
}: {
  servers: McpServerConfig[];
  error: string | null;
  onSave(server: McpServerConfig): Promise<void>;
  onRemove(id: string): Promise<void>;
  onTest(server: McpServerConfig): Promise<McpServerStatus>;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState(servers[0]?.id ?? NEW_SERVER);
  const [draft, setDraft] = useState<McpServerConfig>(() => servers[0] ?? newServer());
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const [imported, setImported] = useState<McpServerConfig[]>([]);
  const [manualOpen, setManualOpen] = useState(selectedId !== NEW_SERVER);

  useEffect(() => {
    const server = servers.find((item) => item.id === selectedId);
    if (server) setDraft(server);
    else if (selectedId !== NEW_SERVER) select(servers[0]?.id ?? NEW_SERVER);
  }, [servers]);

  function select(id: string): void {
    setSelectedId(id);
    setDraft(servers.find((server) => server.id === id) ?? newServer());
    setStatus("");
    setImported([]);
    setImportText("");
    setManualOpen(id !== NEW_SERVER);
  }

  function updateDraft(next: McpServerConfig): void {
    setDraft(next);
    setImported((current) => current.map((server) => server.id === next.id ? next : server));
  }

  function updateStdio(change: Partial<Extract<McpServerConfig["transport"], { type: "stdio" }>>): void {
    if (draft.transport.type !== "stdio") return;
    updateDraft({ ...draft, transport: { ...draft.transport, ...change } });
  }

  function updateHttp(url: string): void {
    if (draft.transport.type !== "http") return;
    updateDraft({ ...draft, transport: { ...draft.transport, url } });
  }

  function updateValues(values: McpValue[]): void {
    updateDraft({
      ...draft,
      transport: draft.transport.type === "stdio"
        ? { ...draft.transport, env: values }
        : { ...draft.transport, headers: values },
    });
  }

  function parseImport(): void {
    try {
      const result = importMcpConfig(importText);
      const first = result.servers[0];
      if (!first) throw new Error("No MCP servers were found");
      setImported(result.servers);
      setDraft(first);
      setManualOpen(true);
      setStatus([
        `${result.servers.length} server${result.servers.length === 1 ? "" : "s"} detected. Review before saving.`,
        ...result.warnings,
      ].join(" "));
    } catch (cause) {
      setStatus(errorMessage(cause));
    }
  }

  async function act(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings view-enter" aria-label="MCP settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>MCP</h1>
        <p className="settings-description">Connect external tools without loading every tool into each model request.</p>

        <div className="mcp-server-bar">
          <select value={selectedId} onChange={(event) => select(event.target.value)} aria-label="MCP server">
            {selectedId === NEW_SERVER ? <option value={NEW_SERVER}>New MCP server</option> : null}
            {servers.map((server) => <option value={server.id} key={server.id}>{server.name}</option>)}
          </select>
          <button type="button" onClick={() => select(NEW_SERVER)}>+ Add server</button>
        </div>

        {selectedId === NEW_SERVER ? (
          <div className="mcp-import">
            <div>
              <strong>Paste MCP configuration</strong>
              <p>Accepts common <code>mcpServers</code>, <code>servers</code>, or single-server JSON.</p>
            </div>
            <textarea
              aria-label="MCP configuration JSON"
              value={importText}
              placeholder={'{\n  "mcpServers": {\n    "Example": { "command": "npx", "args": ["-y", "example-mcp"] }\n  }\n}'}
              onChange={(event) => setImportText(event.target.value)}
            />
            <button className="primary" type="button" disabled={!importText.trim()} onClick={parseImport}>Review configuration</button>
          </div>
        ) : null}

        {imported.length > 1 ? (
          <label className="mcp-imported-server">
            <span>Imported server</span>
            <select value={draft.id} onChange={(event) => {
              const server = imported.find((item) => item.id === event.target.value);
              if (server) setDraft(server);
            }}>
              {imported.map((server) => <option value={server.id} key={server.id}>{server.name}</option>)}
            </select>
          </label>
        ) : null}

        <details className="mcp-manual" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}>
          <summary>{imported.length ? "Review imported configuration" : selectedId === NEW_SERVER ? "Configure manually" : "Server configuration"}</summary>
          <div className="mcp-manual-body">

        <label className="setting-field text-setting">
          <span><strong>Name</strong><small>Shown to you and the model.</small></span>
          <input value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="setting-field text-setting">
          <span><strong>Purpose</strong><small>A short hint used when the model chooses a server.</small></span>
          <input value={draft.description} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} />
        </label>
        <label className="setting-field">
          <span><strong>Transport</strong><small>Local process or remote HTTP server.</small></span>
          <select
            value={draft.transport.type}
            onChange={(event) => updateDraft({
              ...draft,
              transport: event.target.value === "stdio"
                ? { type: "stdio", command: "", args: [], env: [] }
                : { type: "http", url: "", headers: [] },
            })}
          >
            <option value="stdio">Local command</option>
            <option value="http">HTTP</option>
          </select>
        </label>

        {draft.transport.type === "stdio" ? (
          <>
            <label className="setting-field text-setting">
              <span><strong>Command</strong><small>Executable used to start the server.</small></span>
              <input
                value={draft.transport.command}
                placeholder="npx"
                onChange={(event) => updateStdio({ command: event.target.value })}
              />
            </label>
            <label className="setting-field text-setting">
              <span><strong>Arguments</strong><small>One argument per line.</small></span>
              <textarea
                value={draft.transport.args.join("\n")}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path"}
                onChange={(event) => updateStdio({ args: event.target.value.split("\n").filter(Boolean) })}
              />
            </label>
            <label className="setting-field text-setting">
              <span><strong>Working directory</strong><small>Optional process directory.</small></span>
              <input
                value={draft.transport.cwd ?? ""}
                onChange={(event) => updateStdio({ cwd: event.target.value })}
              />
            </label>
            <McpValues
              title="Environment variables"
              description="Passed only to the local MCP process."
              namePlaceholder="MINIMAX_API_KEY"
              values={draft.transport.env}
              onChange={updateValues}
            />
          </>
        ) : (
          <>
            <label className="setting-field text-setting">
              <span><strong>URL</strong><small>Streamable HTTP or legacy SSE endpoint.</small></span>
              <input
                value={draft.transport.url}
                placeholder="https://example.com/mcp"
                onChange={(event) => updateHttp(event.target.value)}
              />
            </label>
            <McpValues
              title="Request headers"
              description="Sent with every request to this MCP server."
              namePlaceholder="Authorization"
              valuePlaceholder="Bearer ..."
              values={draft.transport.headers}
              onChange={updateValues}
            />
          </>
        )}

        <label className="setting-field">
          <span><strong>Enabled</strong><small>Disabled servers are hidden from the model.</small></span>
          <input
            className="selection-checkbox"
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => updateDraft({ ...draft, enabled: event.target.checked })}
          />
        </label>

          </div>
        </details>

        {error || status ? <p className="settings-error">{status || error}</p> : null}
        {manualOpen ? <div className="editor-actions provider-actions">
          <button className="primary" type="button" disabled={busy} onClick={() => void act(async () => {
            const next = imported.length ? imported : [draft];
            for (const server of next) await onSave(server);
            setSelectedId(draft.id);
            setImported([]);
            setStatus(`${next.length} server${next.length === 1 ? "" : "s"} saved`);
          })}>Save{imported.length > 1 ? ` ${imported.length} servers` : ""}</button>
          <button type="button" disabled={busy} onClick={() => void act(async () => {
            const result = await onTest(draft);
            setStatus(`Connected · ${result.toolCount} tools`);
          })}>Test connection</button>
          {selectedId !== NEW_SERVER ? (
            <button type="button" disabled={busy} onClick={() => void act(async () => {
              await onRemove(draft.id);
              select(NEW_SERVER);
            })}>Remove</button>
          ) : null}
        </div> : null}
      </div>
    </section>
  );
}

function newServer(): McpServerConfig {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    enabled: true,
    transport: { type: "stdio", command: "", args: [], env: [] },
  };
}

function McpValues({
  title,
  description,
  namePlaceholder,
  valuePlaceholder = "Value",
  values,
  onChange,
}: {
  title: string;
  description: string;
  namePlaceholder: string;
  valuePlaceholder?: string;
  values: McpValue[];
  onChange(values: McpValue[]): void;
}): JSX.Element {
  function update(id: string, change: Partial<McpValue>): void {
    onChange(values.map((entry) => entry.id === id ? { ...entry, ...change } : entry));
  }

  return (
    <div className="setting-field mcp-values">
      <span><strong>{title}</strong><small>{description}</small></span>
      <div className="mcp-value-list">
        {values.map((entry) => (
          <div className="mcp-value-row" key={entry.id}>
            <input
              aria-label={`${title} name`}
              value={entry.name}
              placeholder={namePlaceholder}
              onChange={(event) => update(entry.id, { name: event.target.value })}
            />
            <input
              aria-label={`${entry.name || title} value`}
              type={entry.secret ? "password" : "text"}
              value={entry.value}
              placeholder={entry.hasValue ? "Stored secret" : valuePlaceholder}
              onChange={(event) => update(entry.id, { value: event.target.value, hasValue: false })}
            />
            <label className="mcp-secret-toggle">
              <input
                className="selection-checkbox"
                type="checkbox"
                checked={entry.secret}
                onChange={(event) => update(entry.id, { secret: event.target.checked })}
              />
              Secret
            </label>
            <button
              className="mcp-value-remove"
              type="button"
              aria-label={`Remove ${entry.name || "entry"}`}
              onClick={() => onChange(values.filter((item) => item.id !== entry.id))}
            >×</button>
          </div>
        ))}
        <button
          className="mcp-value-add"
          type="button"
          onClick={() => onChange([...values, {
            id: crypto.randomUUID(),
            name: "",
            value: "",
            secret: false,
          }])}
        >+ Add {title === "Request headers" ? "header" : "variable"}</button>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
