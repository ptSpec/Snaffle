import { useEffect, useState } from "react";
import { SYSTEM_PROMPT } from "../../../../context/prompt.js";
import { PROJECT } from "../../../../identity.js";
import type { ModelToolSetting } from "../../../api.js";

export function ModelSettings({
  systemPrompt,
  runtimeMetadata,
  tools,
  error,
  onSystemPrompt,
  onToolEnabled,
}: {
  systemPrompt: string;
  runtimeMetadata: string;
  tools: ModelToolSetting[];
  error: string | null;
  onSystemPrompt: (prompt: string) => void;
  onToolEnabled: (name: string, enabled: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(systemPrompt);
  const coreTools = tools.filter((tool) => CORE_TOOLS.has(tool.name));
  const optionalTools = tools.filter((tool) => tool.name === "use_skill");

  useEffect(() => setDraft(systemPrompt), [systemPrompt]);

  return (
    <section className="settings view-enter" aria-label="Model surface settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Model surface</h1>
        <p className="settings-description">See and control what {PROJECT.name} exposes to the model.</p>

        <section className="settings-group">
          <div className="model-setting-heading">
            <div>
              <h2>System prompt</h2>
              <p className="settings-description">Applied to new requests, including existing threads.</p>
            </div>
            <button type="button" onClick={() => {
              setDraft(SYSTEM_PROMPT);
              onSystemPrompt(SYSTEM_PROMPT);
            }}>Reset</button>
          </div>
          <textarea
            className="model-system-prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
          <div className="model-setting-actions">
            <button
              className="primary"
              type="button"
              disabled={!draft.trim() || draft === systemPrompt}
              onClick={() => onSystemPrompt(draft)}
            >Save prompt</button>
          </div>
        </section>

        <section className="settings-group">
          <h2>Runtime metadata</h2>
          <p className="settings-description">
            Generated for every request and appended separately from the editable prompt. It includes the current time,
            platform, workspace, and shell.
          </p>
          <pre className="model-readonly-block">{runtimeMetadata}</pre>
        </section>

        <section className="settings-group">
          <h2>Tools</h2>
          <p className="settings-description">
            Core coding tools are always available. Optional features are controlled where they are configured.
          </p>

          <details className="model-tool-section">
            <summary>Core tools <small>{coreTools.length} required tools</small></summary>
            <div className="model-tool-list">
              {coreTools.map((tool) => <ToolCard key={tool.name} tool={tool} status="Always available" />)}
            </div>
          </details>

          {optionalTools.length ? <>
            <h3 className="model-tool-section-title">Optional tools</h3>
            <div className="model-tool-list">
              {optionalTools.map((tool) => (
                <ToolCard
                  key={tool.name}
                  tool={tool}
                  status={tool.available ? tool.enabled ? "Available to models" : "Disabled" : "No skills found"}
                  onEnabled={(enabled) => onToolEnabled(tool.name, enabled)}
                />
              ))}
            </div>
          </> : null}

          <h3 className="model-tool-section-title">Configured elsewhere</h3>
          <div className="model-feature-tools">
            {MANAGED_TOOLS.map((group) => {
              const groupTools = tools.filter((tool) => group.tools.includes(tool.name));
              const active = groupTools.some((tool) => tool.available);
              return (
                <details className="model-tool-section" key={group.label}>
                  <summary>
                    {group.label}
                    <small>{active ? `Available · managed in ${group.page} settings` : `Enable in ${group.page} settings`}</small>
                  </summary>
                  <div className="model-tool-list">
                    {groupTools.map((tool) => (
                      <ToolCard key={tool.name} tool={tool} status={tool.available ? "Available to models" : "Unavailable"} />
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function ToolCard({
  tool,
  status,
  onEnabled,
}: {
  tool: ModelToolSetting;
  status: string;
  onEnabled?: (enabled: boolean) => void;
}): JSX.Element {
  return (
    <div className="model-tool">
      <div className="model-tool-heading">
        <span><strong>{tool.name}</strong><small>{status}</small></span>
        {onEnabled ? (
          <input
            className="selection-checkbox"
            type="checkbox"
            checked={tool.enabled}
            disabled={!tool.available}
            onChange={(event) => onEnabled(event.target.checked)}
            aria-label={`${tool.enabled ? "Disable" : "Enable"} ${tool.name}`}
          />
        ) : null}
      </div>
      <p>{tool.description}</p>
      <details>
        <summary>View definition</summary>
        <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
      </details>
    </div>
  );
}

const CORE_TOOLS = new Set(["run_command", "search_files", "read_file", "edit_file", "write_file"]);

const MANAGED_TOOLS = [
  { label: "Web tools", page: "Web", tools: ["web_search", "web_fetch", "youtube_transcript"] },
  { label: "MCP", page: "MCP", tools: ["mcp"] },
  { label: "Subagents", page: "Agent", tools: ["delegate_task"] },
];
