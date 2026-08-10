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

        <div className="settings-group">
          <h2>Subagent</h2>
          <p className="settings-description">
            Optionally let the main model delegate focused coding work to another model.
          </p>
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
            label="Local parallel capacity"
            description="Maximum simultaneous model requests on the subagent connection, shared with main conversations."
            value={subagent.localConcurrency}
            min={1}
            max={16}
            onChange={(localConcurrency) => update({ localConcurrency })}
          />
          <label className="setting-field">
            <span>
              <strong>Remote overflow provider</strong>
              <small>Optional. Delegated tasks use this connection while every local slot is occupied.</small>
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
              <option value="">Wait for a local slot</option>
              {connections
                .filter((connection) => connection.id !== subagent.providerConnectionId)
                .map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name}</option>
                ))}
            </select>
          </label>
          <label className="setting-field">
            <span>
              <strong>Remote overflow model</strong>
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
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}
