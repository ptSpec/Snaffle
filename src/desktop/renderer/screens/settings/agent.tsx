import { useState } from "react";
import { SearchPicker } from "../../components/search-picker.js";
import { NumberSetting } from "./controls.js";
import type { SubagentProfile } from "../../../../agent/subagents/profile.js";
import type { ImageUnderstandingProfile } from "../../../../attachments/vision.js";
import type { ProviderCatalog, ProviderConnection } from "../../../../providers/provider.js";

export function AgentSettings({
  maxSteps,
  autoTitleGeneration,
  providerTimeoutMinutes,
  providerRetries,
  subagent,
  imageUnderstanding,
  providerConnections,
  providerCatalogs,
  error,
  onMaxSteps,
  onAutoTitleGeneration,
  onProviderTimeoutMinutes,
  onProviderRetries,
  onSubagent,
  onImageUnderstanding,
}: {
  maxSteps: number;
  autoTitleGeneration: boolean;
  providerTimeoutMinutes: number;
  providerRetries: number;
  subagent: SubagentProfile;
  imageUnderstanding: ImageUnderstandingProfile;
  providerConnections: ProviderConnection[];
  providerCatalogs: ProviderCatalog[];
  error: string | null;
  onMaxSteps: (maxSteps: number) => void;
  onAutoTitleGeneration: (enabled: boolean) => void;
  onProviderTimeoutMinutes: (minutes: number) => void;
  onProviderRetries: (retries: number) => void;
  onSubagent: (profile: SubagentProfile) => void;
  onImageUnderstanding: (profile: ImageUnderstandingProfile) => void;
}): JSX.Element {
  const [openSection, setOpenSection] = useState<"agent" | "subagent" | "images" | null>("agent");
  const connections = providerConnections.filter((connection) => connection.enabled);
  const modelChoices = providerCatalogs.flatMap((catalog) =>
    connections.some((connection) => connection.id === catalog.connection.id)
      ? catalog.models.map((model) => ({
          connectionId: catalog.connection.id,
          connectionName: catalog.connection.name,
          modelId: model.id,
          modelName: model.name,
          inputModalities: model.inputModalities,
          toolUseUnavailableReason: model.toolUseUnavailableReason,
        }))
      : [],
  );
  const toolModelChoices = modelChoices.filter((choice) => !choice.toolUseUnavailableReason);
  const selectedConnection = connections.find((connection) => connection.id === subagent.providerConnectionId);
  const selectedChoice = toolModelChoices.find((choice) =>
    choice.connectionId === subagent.providerConnectionId && choice.modelId === subagent.model
  );
  const subagentModelOptions = toolModelChoices.map((choice) => ({
    value: modelValue(choice.connectionId, choice.modelId),
    label: choice.modelName,
    detail: `${choice.connectionName} · ${choice.modelId}`,
  }));
  const overflowChoices = toolModelChoices.filter((choice) => choice.connectionId !== subagent.providerConnectionId);
  const overflowOptions = overflowChoices.map((choice) => ({
    value: modelValue(choice.connectionId, choice.modelId),
    label: choice.modelName,
    detail: `${choice.connectionName} · ${choice.modelId}`,
  }));
  const imageModelChoices = modelChoices.filter((choice) => choice.inputModalities?.includes("image"));
  const imageModelOptions = imageModelChoices.map((choice) => ({
    value: modelValue(choice.connectionId, choice.modelId),
    label: choice.modelName,
    detail: `${choice.connectionName} · ${choice.modelId}`,
  }));
  if (subagent.model && !modelChoices.some((choice) =>
    choice.connectionId === subagent.providerConnectionId && choice.modelId === subagent.model
  )) {
    subagentModelOptions.push({
      value: modelValue(subagent.providerConnectionId, subagent.model),
      label: subagent.model,
      detail: selectedConnection?.name ?? "Saved model",
    });
  }
  if (subagent.overflowModel && !overflowChoices.some((choice) =>
    choice.connectionId === subagent.overflowProviderConnectionId && choice.modelId === subagent.overflowModel
  )) {
    overflowOptions.push({
      value: modelValue(subagent.overflowProviderConnectionId, subagent.overflowModel),
      label: subagent.overflowModel,
      detail: "Saved overflow model",
    });
  }

  function update(change: Partial<SubagentProfile>): void {
    onSubagent({ ...subagent, ...change });
  }

  function selectModel(value: string): void {
    const [connectionId, model] = value.split("\n");
    update({
      modelMode: "fixed",
      providerConnectionId: connectionId ?? "",
      model: model ?? "",
      ...(connectionId === subagent.overflowProviderConnectionId
        ? { overflowProviderConnectionId: "", overflowModel: "" }
        : {}),
    });
  }

  function selectOverflowModel(value: string): void {
    const [overflowProviderConnectionId, overflowModel] = value.split("\n");
    update({
      overflowProviderConnectionId: overflowProviderConnectionId ?? "",
      overflowModel: overflowModel ?? "",
    });
  }

  function selectImageModel(value: string): void {
    const [providerConnectionId, model] = value.split("\n");
    onImageUnderstanding({
      ...imageUnderstanding,
      providerConnectionId: providerConnectionId ?? "",
      model: model ?? "",
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
            <label className="setting-field">
              <span>
                <strong>Automatic thread titles</strong>
                <small>Generate a short title after the first successful response.</small>
              </span>
              <input
                className="selection-checkbox"
                type="checkbox"
                checked={autoTitleGeneration}
                onChange={(event) => onAutoTitleGeneration(event.target.checked)}
              />
            </label>
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
              <strong>Use another model</strong>
              <small>Otherwise subagents follow the model selected in each conversation.</small>
            </span>
            <input
              className="selection-checkbox"
              type="checkbox"
              checked={subagent.modelMode === "fixed"}
              onChange={(event) => update(event.target.checked
                ? { modelMode: "fixed" }
                : { modelMode: "main", providerConnectionId: "", model: "" })}
            />
          </label>
          <div className="setting-field">
            <span>
              <strong>Subagent model</strong>
              <small>Used for every delegated task when the override is enabled.</small>
            </span>
            <SearchPicker
              value={modelValue(subagent.providerConnectionId, subagent.model)}
              disabled={subagent.modelMode !== "fixed" || !toolModelChoices.length}
              className="subagent-model-picker"
              placeholder={subagent.modelMode === "main"
                ? "Uses main conversation model"
                : toolModelChoices.length ? "Select model" : "No models available"}
              searchPlaceholder="Search providers and models…"
              options={subagentModelOptions}
              onChange={selectModel}
            />
          </div>
          {subagent.modelMode === "fixed" && selectedConnection ? (
            <p className="subagent-routing-summary">
              Subagents use {selectedChoice?.modelName ?? subagent.model} through {selectedConnection.name}. This connection allows{" "}
              {selectedConnection.requestLimit} parallel {selectedConnection.requestLimit === 1 ? "generation" : "generations"} across Snaffle.{" "}
              Change this limit in Provider settings. Busy behavior and any overflow model are configured below.
            </p>
          ) : null}
          <details className="subagent-advanced">
            <summary>Advanced</summary>
            <label className="setting-field">
              <span>
                <strong>When busy</strong>
                <small>Wait for a generation slot, or send additional delegated work through another connection.</small>
              </span>
              <select
                value={subagent.overflowProviderConnectionId && subagent.overflowModel ? "overflow" : "wait"}
                onChange={(event) => {
                  const overflow = overflowChoices[0];
                  update(event.target.value === "overflow" && overflow
                    ? {
                        overflowProviderConnectionId: overflow.connectionId,
                        overflowModel: overflow.modelId,
                      }
                    : { overflowProviderConnectionId: "", overflowModel: "" });
                }}
              >
                <option value="wait">Wait for availability</option>
                <option value="overflow" disabled={!overflowChoices.length}>Use overflow model</option>
              </select>
            </label>
            {subagent.overflowProviderConnectionId && subagent.overflowModel ? (
              <div className="setting-field">
                <span>
                  <strong>Overflow model</strong>
                  <small>Used only for delegated tasks that start while the selected model is full.</small>
                </span>
                <SearchPicker
                  value={modelValue(subagent.overflowProviderConnectionId, subagent.overflowModel)}
                  className="subagent-model-picker"
                  placeholder="Select overflow model"
                  searchPlaceholder="Search providers and models…"
                  options={overflowOptions}
                  onChange={selectOverflowModel}
                />
              </div>
            ) : null}
            <NumberSetting
              label="Maximum subagent turns"
              description="Maximum turns for one delegated task, from 0 to 250. Zero disables delegation."
              value={subagent.maxSteps}
              min={0}
              max={250}
              onChange={(maxSteps) => update({ maxSteps })}
            />
          </details>
          </div></div>
        </div>

        <div className={openSection === "images" ? "agent-settings-card open" : "agent-settings-card"}>
          <button
            className="agent-settings-summary"
            type="button"
            aria-expanded={openSection === "images"}
            onClick={() => setOpenSection((value) => value === "images" ? null : "images")}
          >
            <span><strong>Image understanding</strong><small>Optional vision helper for text-only models.</small></span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
          <div className="agent-settings-reveal"><div className="agent-settings-body">
            <label className="setting-field">
              <span>
                <strong>Use fallback helper</strong>
                <small>When enabled, images are automatically routed here only when the main model is text-only.</small>
              </span>
              <input
                className="selection-checkbox"
                type="checkbox"
                checked={imageUnderstanding.enabled}
                onChange={(event) => onImageUnderstanding({ ...imageUnderstanding, enabled: event.target.checked })}
              />
            </label>
            <div className="setting-field">
              <span>
                <strong>Vision model</strong>
                <small>May use any configured provider independently of the main model.</small>
              </span>
              <SearchPicker
                value={modelValue(imageUnderstanding.providerConnectionId, imageUnderstanding.model)}
                disabled={!imageModelChoices.length}
                className="subagent-model-picker"
                placeholder={imageModelChoices.length ? "Select vision model" : "No vision models available"}
                searchPlaceholder="Search vision models…"
                options={imageModelOptions}
                onChange={selectImageModel}
              />
            </div>
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
