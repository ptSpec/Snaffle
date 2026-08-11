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

  useEffect(() => setDraft(systemPrompt), [systemPrompt]);

  return (
    <section className="settings view-enter" aria-label="Model settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Model</h1>
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
            Feature settings control whether a tool is available. These switches are the final override: turning a tool
            off here always hides it from future model requests. Definitions are read-only.
          </p>
          <div className="model-tool-list">
            {tools.map((tool) => (
              <div className="model-tool" key={tool.name}>
                <div className="model-tool-heading">
                  <span>
                    <strong>{tool.name}</strong>
                    <small>{tool.available
                      ? tool.enabled ? "Available to models" : "Disabled on this page"
                      : tool.name === "delegate_task"
                        ? "Unavailable — enable and configure Subagent in Agent settings first"
                        : "Unavailable — enable or configure its feature first"}</small>
                  </span>
                  <input
                    className="selection-checkbox"
                    type="checkbox"
                    checked={tool.enabled}
                    disabled={!tool.available}
                    onChange={(event) => onToolEnabled(tool.name, event.target.checked)}
                    aria-label={`${tool.enabled ? "Disable" : "Enable"} ${tool.name}`}
                  />
                </div>
                <p>{tool.description}</p>
                <details>
                  <summary>View definition</summary>
                  <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        </section>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}
