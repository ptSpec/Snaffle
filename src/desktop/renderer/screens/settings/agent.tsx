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
  const selectedConnection = connections.find((connection) => connection.id === subagent.providerConnectionId);
  const models = providerCatalogs.find((catalog) => catalog.connection.id === selectedConnection?.id)?.models ?? [];
  const overflowConnection = connections.find(
    (connection) => connection.id === subagent.overflowProviderConnectionId,
  );
  const overflowModels = providerCatalogs.find(
    (catalog) => catalog.connection.id === overflowConnection?.id,
  )?.models ?? [];

  function update(change: Partial<SubagentProfile>): void {
    onSubagent({ ...subagent, ...change });
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
            <span><strong>Subagent <span className="agent-guns subagent-guns">🔫🔫🔫</span></strong><small>Delegated model, limits, and overflow routing.</small></span>
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
              <strong>Provider</strong>
              <small>The child can use a local or remote connection independently of the main model.</small>
            </span>
            <select
              value={subagent.providerConnectionId}
              onChange={(event) => {
                const providerConnectionId = event.target.value;
                const firstModel = providerCatalogs.find(
                  (catalog) => catalog.connection.id === providerConnectionId,
                )?.models[0]?.id ?? "";
                update({ providerConnectionId, model: firstModel });
              }}
            >
              <option value="">Select provider</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>{connection.name}</option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>
              <strong>Model</strong>
              <small>The model used for delegated tasks.</small>
            </span>
            <select
              value={subagent.model}
              disabled={!selectedConnection || models.length === 0}
              onChange={(event) => update({ model: event.target.value })}
            >
              <option value="">{models.length ? "Select model" : "No models available"}</option>
              {subagent.model && !models.some((model) => model.id === subagent.model)
                ? <option value={subagent.model}>{subagent.model}</option>
                : null}
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <NumberSetting
            label="Maximum subagent turns"
            description="Maximum turns for one delegated task, from 0 to 100. Zero disables delegation."
            value={subagent.maxSteps}
            min={0}
            max={100}
            onChange={(maxSteps) => update({ maxSteps })}
          />
          <NumberSetting
            label="Connection request limit"
            description="Maximum simultaneous model requests through this connection. Main conversations using the same connection share this limit."
            value={subagent.localConcurrency}
            min={1}
            max={16}
            onChange={(localConcurrency) => update({ localConcurrency })}
          />
          <label className="setting-field">
            <span>
              <strong>Overflow connection</strong>
              <small>Optional. Delegated tasks use this connection while every primary connection slot is occupied.</small>
            </span>
            <select
              value={subagent.overflowProviderConnectionId}
              onChange={(event) => {
                const overflowProviderConnectionId = event.target.value;
                const overflowModel = providerCatalogs.find(
                  (catalog) => catalog.connection.id === overflowProviderConnectionId,
                )?.models[0]?.id ?? "";
                update({ overflowProviderConnectionId, overflowModel });
              }}
            >
              <option value="">Wait for an available slot</option>
              {connections
                .filter((connection) => connection.id !== subagent.providerConnectionId)
                .map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name}</option>
                ))}
            </select>
          </label>
          <label className="setting-field">
            <span>
              <strong>Overflow model</strong>
              <small>The fallback model used only when the configured capacity is full.</small>
            </span>
            <select
              value={subagent.overflowModel}
              disabled={!overflowConnection || overflowModels.length === 0}
              onChange={(event) => update({ overflowModel: event.target.value })}
            >
              <option value="">{overflowModels.length ? "Select model" : "No overflow provider"}</option>
              {subagent.overflowModel && !overflowModels.some((model) => model.id === subagent.overflowModel)
                ? <option value={subagent.overflowModel}>{subagent.overflowModel}</option>
                : null}
              {overflowModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          </div></div>
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}
