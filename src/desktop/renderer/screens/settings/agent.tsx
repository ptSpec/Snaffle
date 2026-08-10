import { useState } from "react";
import { NumberSetting } from "./controls.js";
import type { SubagentProfile } from "../../../../agent/subagents/profile.js";
import type { ProviderCatalog, ProviderConnection } from "../../../../providers/provider.js";

export function AgentSettings({
  maxSteps,
  providerTimeoutMinutes,
  providerRetries,
  subagent,
  providerConnections,
  providerCatalogs,
  error,
  onMaxSteps,
  onProviderTimeoutMinutes,
  onProviderRetries,
  onSubagent,
}: {
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
  subagent: SubagentProfile;
  providerConnections: ProviderConnection[];
  providerCatalogs: ProviderCatalog[];
  error: string | null;
  onMaxSteps: (maxSteps: number) => void;
  onProviderTimeoutMinutes: (minutes: number) => void;
  onProviderRetries: (retries: number) => void;
  onSubagent: (profile: SubagentProfile) => void;
}): JSX.Element {
  const [openSection, setOpenSection] = useState<"agent" | "subagent" | null>("agent");
  const connections = providerConnections.filter((connection) => connection.enabled);
  const modelChoices = providerCatalogs.flatMap((catalog) =>
    connections.some((connection) => connection.id === catalog.connection.id)
      ? catalog.models.map((model) => ({
          connectionId: catalog.connection.id,
          connectionName: catalog.connection.name,
          modelId: model.id,
          modelName: model.name,
        }))
      : [],
  );
  const selectedConnection = connections.find((connection) => connection.id === subagent.providerConnectionId);
  const fallbackChoices = modelChoices.filter((choice) => choice.connectionId !== subagent.providerConnectionId);
  const selectedChoice = modelChoices.find((choice) =>
    choice.connectionId === subagent.providerConnectionId && choice.modelId === subagent.model
  );
  const overflowChoice = fallbackChoices.find((choice) =>
    choice.connectionId === subagent.overflowProviderConnectionId && choice.modelId === subagent.overflowModel
  );
  const overflowConnection = connections.find(
    (connection) => connection.id === subagent.overflowProviderConnectionId,
  );
  const usesOverflow = Boolean(subagent.overflowProviderConnectionId && subagent.overflowModel);

  function update(change: Partial<SubagentProfile>): void {
    onSubagent({ ...subagent, ...change });
  }

  function selectModel(value: string, overflow = false): void {
    const [connectionId, model] = value.split("\n");
    update(overflow
      ? { overflowProviderConnectionId: connectionId ?? "", overflowModel: model ?? "" }
      : {
          providerConnectionId: connectionId ?? "",
          model: model ?? "",
          ...(connectionId === subagent.overflowProviderConnectionId
            ? { overflowProviderConnectionId: "", overflowModel: "" }
            : {}),
        });
  }

  return (
    <section className="settings view-enter" aria-label="Agent settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Agent</h1>
        <p className="settings-description">Control the limits applied to new runs.</p>

        <div className={openSection === "agent" ? "agent-settings-card open" : "agent-settings-card"}>
          <button
            className="agent-settings-summary"
            type="button"
            aria-expanded={openSection === "agent"}
            onClick={() => setOpenSection((value) => value === "agent" ? null : "agent")}
          >
            <span><strong>Agent <span className="agent-guns">🔫</span></strong><small>Run limits and provider retry behavior.</small></span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
          <div className="agent-settings-reveal"><div className="agent-settings-body">
            <NumberSetting
              label="Maximum turns"
              description="Maximum model turns per run, from 1 to 200."
              value={maxSteps}
              min={1}
              max={200}
              onChange={onMaxSteps}
            />
            <NumberSetting
              label="Provider inactivity timeout"
              description="Retry when a provider stream sends no data for this many minutes."
              value={providerTimeoutMinutes}
              min={1}
              max={30}
              onChange={onProviderTimeoutMinutes}
            />
            <NumberSetting
              label="Provider retries"
              description="Additional attempts after a provider failure. Later retries wait up to 45 seconds."
              value={providerRetries}
              min={0}
              max={10}
              onChange={onProviderRetries}
            />
          </div></div>
        </div>

        <div className={openSection === "subagent" ? "agent-settings-card open" : "agent-settings-card"}>
          <button
            className="agent-settings-summary"
            type="button"
            aria-expanded={openSection === "subagent"}
            onClick={() => setOpenSection((value) => value === "subagent" ? null : "subagent")}
          >
            <span><strong>Subagent <span className="agent-guns subagent-guns">🔫🔫🔫</span></strong><small>Delegated model and busy behavior.</small></span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
          <div className="agent-settings-reveal"><div className="agent-settings-body">
          <label className="setting-field">
            <span>
              <strong>Enabled</strong>
              <small>Adds one delegate_task tool to new runs.</small>
            </span>
            <input
              className="selection-checkbox"
              type="checkbox"
              checked={subagent.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
          </label>
          <label className="setting-field">
            <span>
              <strong>Model</strong>
              <small>The provider and model used for delegated tasks.</small>
            </span>
            <select
              value={modelValue(subagent.providerConnectionId, subagent.model)}
              disabled={!modelChoices.length}
              onChange={(event) => selectModel(event.target.value)}
            >
              <option value="">{modelChoices.length ? "Select model" : "No models available"}</option>
              {subagent.model && !selectedChoice
                ? <option value={modelValue(subagent.providerConnectionId, subagent.model)}>{subagent.model}</option>
                : null}
              {connections.map((connection) => (
                <optgroup key={connection.id} label={connection.name}>
                  {modelChoices
                    .filter((choice) => choice.connectionId === connection.id)
                    .map((choice) => (
                      <option key={choice.modelId} value={modelValue(choice.connectionId, choice.modelId)}>
                        {choice.modelName}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>
              <strong>When busy</strong>
              <small>Wait for the selected provider or send extra subagents to another model.</small>
            </span>
            <select
              value={usesOverflow ? "fallback" : "wait"}
              onChange={(event) => {
                const fallback = fallbackChoices[0];
                update(event.target.value === "fallback" && fallback
                  ? { overflowProviderConnectionId: fallback.connectionId, overflowModel: fallback.modelId }
                  : { overflowProviderConnectionId: "", overflowModel: "" });
              }}
            >
              <option value="wait">Wait for availability</option>
              <option value="fallback" disabled={!fallbackChoices.length}>Use another model</option>
            </select>
          </label>
          {usesOverflow ? (
            <label className="setting-field">
              <span>
                <strong>Fallback model</strong>
                <small>Used for subagents only while the selected provider is full.</small>
              </span>
              <select
                value={modelValue(subagent.overflowProviderConnectionId, subagent.overflowModel)}
                onChange={(event) => selectModel(event.target.value, true)}
              >
                {subagent.overflowModel && !overflowChoice
                  ? <option value={modelValue(subagent.overflowProviderConnectionId, subagent.overflowModel)}>{subagent.overflowModel}</option>
                  : null}
                {connections
                  .filter((connection) => connection.id !== subagent.providerConnectionId)
                  .map((connection) => (
                    <optgroup key={connection.id} label={connection.name}>
                      {fallbackChoices
                        .filter((choice) => choice.connectionId === connection.id)
                        .map((choice) => (
                          <option key={choice.modelId} value={modelValue(choice.connectionId, choice.modelId)}>
                            {choice.modelName}
                          </option>
                        ))}
                    </optgroup>
                  ))}
              </select>
            </label>
          ) : null}
          {selectedConnection ? (
            <p className="subagent-routing-summary">
              Subagents use {selectedChoice?.modelName ?? subagent.model} through {selectedConnection.name}. Up to{" "}
              {selectedConnection.requestLimit} {selectedConnection.requestLimit === 1 ? "request" : "requests"} share this
              connection across the app. Additional subagents {overflowConnection && overflowChoice
                ? `use ${overflowChoice.modelName} through ${overflowConnection.name}`
                : "wait for availability"}. Main conversations always wait.
            </p>
          ) : null}
          <details className="subagent-advanced">
            <summary>Advanced</summary>
            <NumberSetting
              label="Maximum subagent turns"
              description="Maximum turns for one delegated task, from 0 to 100. Zero disables delegation."
              value={subagent.maxSteps}
              min={0}
              max={100}
              onChange={(maxSteps) => update({ maxSteps })}
            />
          </details>
          </div></div>
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function modelValue(connectionId: string, modelId: string): string {
  return connectionId && modelId ? `${connectionId}\n${modelId}` : "";
}
