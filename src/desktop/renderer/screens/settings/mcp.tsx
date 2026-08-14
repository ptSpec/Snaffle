import { useEffect, useState } from "react";
import { importMcpConfig } from "../../../../mcp/import.js";
import type { McpServerConfig, McpServerStatus, McpValue } from "../../../../mcp/types.js";

const NEW_SERVER = "new";

export function McpSettings({
  enabled,
  servers,
  error,
  onEnabled,
  onSave,
  onRemove,
  onTest,
}: {
  enabled: boolean;
  servers: McpServerConfig[];
  error: string | null;
  onEnabled(enabled: boolean): void;
  onSave(server: McpServerConfig): Promise<void>;
  onRemove(id: string): Promise<void>;
  onTest(server: McpServerConfig): Promise<McpServerStatus>;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState(servers[0]?.id ?? NEW_SERVER);
  const [draft, setDraft] = useState<McpServerConfig>(() => servers[0] ?? newServer());
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const [imported, setImported] = useState<McpServerConfig[]>([]);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const server = servers.find((item) => item.id === selectedId);
    if (server) setDraft(server);
    else if (selectedId !== NEW_SERVER) select(servers[0]?.id ?? NEW_SERVER);
  }, [servers]);

  function select(id: string): void {
    setSelectedId(id);
    setDraft(servers.find((server) => server.id === id) ?? newServer());
    setStatus("");
    setStatusError(false);
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
        `${result.servers.length} server${result.servers.length === 1 ? "" : "s"} detected. Add any credentials required by the server, then test the connection.`,
        ...result.warnings,
      ].join(" "));
      setStatusError(false);
    } catch (cause) {
      setStatus(errorMessage(cause));
      setStatusError(true);
    }
  }

  async function act(action: () => Promise<void>, pending = ""): Promise<void> {
    setBusy(true);
    setStatus(pending);
    setStatusError(false);
    try {
      await action();
    } catch (cause) {
      setStatus(errorMessage(cause));
      setStatusError(true);
    } finally {
      setBusy(false);
    }
  }

  function renderEditor(): JSX.Element {
    return <>
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
            <McpArguments args={draft.transport.args} onChange={(args) => updateStdio({ args })} />
            <label className="setting-field text-setting">
              <span><strong>Working directory</strong><small>Optional process directory.</small></span>
              <input
                value={draft.transport.cwd ?? ""}
                onChange={(event) => updateStdio({ cwd: event.target.value })}
              />
            </label>
            <p className="mcp-host-warning">Local MCP commands run directly on your computer, outside the workspace command sandbox.</p>
            <McpValues
              title="Authentication and environment"
              description="Add API keys or other variables documented by this server. Mark sensitive values Secret."
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
              title="Authentication and headers"
              description="Add Authorization or other headers documented by this server. Mark sensitive values Secret."
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

      {error || status ? (
        <p className={error || statusError ? "settings-error" : "settings-status"}>{status || error}</p>
      ) : null}
      <div className="editor-actions provider-actions mcp-editor-actions">
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
        }, "Connecting…")}>{busy && status === "Connecting…" ? "Connecting…" : "Test connection"}</button>
        {selectedId !== NEW_SERVER ? (
          <button type="button" disabled={busy} onClick={() => void act(async () => {
            await onRemove(draft.id);
            select(NEW_SERVER);
          })}>Remove</button>
        ) : null}
      </div>
    </>;
  }

  return (
    <section className="settings view-enter" aria-label="MCP settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>MCP</h1>
        <p className="settings-description">Connect external tools without loading every tool into each model request.</p>

        <label className="setting-field">
          <span>
            <strong>MCP tools</strong>
            <small>Expose enabled MCP servers to the model. Turning this off keeps every server configuration saved.</small>
          </span>
          <input
            className="selection-checkbox"
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabled(event.target.checked)}
          />
        </label>

        <button
          className="mcp-add-server"
          type="button"
          onClick={() => { if (selectedId !== NEW_SERVER) select(NEW_SERVER); }}
        >+ Add new server</button>

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

        {selectedId === NEW_SERVER ? (
          <details className="mcp-manual" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}>
            <summary>{imported.length ? "Review imported configuration" : "Configure manually"}</summary>
            {manualOpen ? renderEditor() : null}
          </details>
        ) : null}

        <div className="mcp-server-list">
          {servers.map((server) => {
            const open = selectedId === server.id && manualOpen;
            return <div className={open ? "mcp-server-card open" : "mcp-server-card"} key={server.id}>
              <button
                className="mcp-server-summary"
                type="button"
                aria-expanded={open}
                onClick={() => open ? setManualOpen(false) : select(server.id)}
              >
                <span>
                  <strong>{server.name}</strong>
                  <small>{server.enabled ? "Enabled" : "Disabled"} · {server.transport.type === "stdio" ? "Local command" : "HTTP"}</small>
                </span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
              </button>
              <div className="mcp-server-reveal"><div className="mcp-server-body">
                {selectedId === server.id ? renderEditor() : null}
              </div></div>
            </div>;
          })}
        </div>
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
    <div className="setting-field mcp-collection">
      <span><strong>{title}</strong><small>{description}</small></span>
      <div className="mcp-value-list">
        {values.map((entry) => (
          <div className="mcp-entry-row mcp-value-row" key={entry.id}>
            <label className="mcp-entry-field">
              <span>Name</span>
              <input
                aria-label={`${title} name`}
                value={entry.name}
                placeholder={namePlaceholder}
                onChange={(event) => update(entry.id, { name: event.target.value })}
              />
            </label>
            <label className="mcp-entry-field">
              <span>Value</span>
              <input
                aria-label={`${entry.name || title} value`}
                type={entry.secret ? "password" : "text"}
                value={entry.value}
                placeholder={entry.hasValue ? "Stored secret" : valuePlaceholder}
                onChange={(event) => update(entry.id, { value: event.target.value, hasValue: false })}
              />
            </label>
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
        >+ Add {title.includes("headers") ? "header" : "variable"}</button>
      </div>
    </div>
  );
}

function McpArguments({
  args,
  onChange,
}: {
  args: string[];
  onChange(args: string[]): void;
}): JSX.Element {
  return (
    <div className="setting-field mcp-collection">
      <span><strong>Arguments</strong><small>Passed to the command in this order.</small></span>
      <div className="mcp-argument-list">
        {args.map((argument, index) => (
          <div className="mcp-entry-row mcp-argument-row" key={index}>
            <input
              aria-label={`Argument ${index + 1}`}
              value={argument}
              placeholder={index === 0 ? "-y" : "Argument"}
              onChange={(event) => onChange(args.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
            />
            <button
              className="mcp-value-remove"
              type="button"
              aria-label={`Remove argument ${index + 1}`}
              onClick={() => onChange(args.filter((_, itemIndex) => itemIndex !== index))}
            >×</button>
          </div>
        ))}
        <button className="mcp-value-add" type="button" onClick={() => onChange([...args, ""])}>+ Add argument</button>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
