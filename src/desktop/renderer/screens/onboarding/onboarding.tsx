import { useEffect, useMemo, useState } from "react";
import { PROJECT } from "../../../../identity.js";
import type { SubagentProfile } from "../../../../agent/subagents/profile.js";
import type {
  ProviderCatalog,
  ProviderConnection,
  ProviderConnectionInput,
  ProviderStatus,
} from "../../../../providers/provider.js";
import { PROVIDER_PROFILES, providerProfile, splitModelVariant } from "../../../../providers/profiles.js";
import type { KetchSearchBackend, WebSearchBackend } from "../../../../tools/web/types.js";
import { THEMES } from "../../../themes/index.js";
import { SearchPicker } from "../../components/search-picker.js";
import { WEB_BACKENDS } from "../settings/web.js";
import logoUrl from "../../../../../assets/logo-borderless.png?url";

type Section = "model" | "appearance" | "web" | "subagent";
type SectionState = "pending" | "done" | "skipped";

const PROVIDER_WEB_BACKENDS: Partial<Record<string, WebSearchBackend>> = {
  openrouter: "openrouter",
  deepseek: "deepseek",
};

export function Onboarding({
  dismissible,
  themeId,
  connections,
  catalogs,
  loadingModels,
  defaultConnectionId,
  defaultModel,
  webEnabled,
  webBackend,
  webKeyBackends,
  subagent,
  onConnect,
  onManualModel,
  onTheme,
  onWebEnabled,
  onWebBackend,
  onWebKey,
  onSubagent,
  onComplete,
  onDismiss,
}: {
  dismissible: boolean;
  themeId: string;
  connections: ProviderConnection[];
  catalogs: ProviderCatalog[];
  loadingModels: boolean;
  defaultConnectionId: string;
  defaultModel: string | null;
  webEnabled: boolean;
  webBackend: WebSearchBackend;
  webKeyBackends: KetchSearchBackend[];
  subagent: SubagentProfile;
  onConnect(input: ProviderConnectionInput): Promise<{
    connectionId: string;
    status: ProviderStatus;
    connected: boolean;
  }>;
  onManualModel(connection: ProviderConnection, model: string): Promise<void>;
  onTheme(themeId: string): void;
  onWebEnabled(enabled: boolean): void;
  onWebBackend(backend: WebSearchBackend): void;
  onWebKey(backend: KetchSearchBackend, apiKey: string): Promise<void>;
  onSubagent(profile: SubagentProfile): void;
  onComplete(): Promise<void>;
  onDismiss(): void;
}): JSX.Element {
  const [openSection, setOpenSection] = useState<Section | null>("model");
  const [connectionId, setConnectionId] = useState(defaultConnectionId);
  const [addingConnection, setAddingConnection] = useState(false);
  const [providerId, setProviderId] = useState("openrouter");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [providerConnected, setProviderConnected] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [manualModelBusy, setManualModelBusy] = useState(false);
  const [webApiKey, setWebApiKey] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sectionStates, setSectionStates] = useState<Record<Section, SectionState>>({
    model: "pending",
    appearance: "pending",
    web: "pending",
    subagent: "pending",
  });
  const connection = addingConnection
    ? undefined
    : connections.find((item) => item.id === connectionId);
  const profile = providerProfile(connection?.providerId ?? providerId);
  const selectedCatalog = catalogs.find((item) => item.connection.id === connectionId);
  const selectedModelError = selectedCatalog?.models.find((model) =>
    model.toolUseUnavailableReason
  )?.toolUseUnavailableReason;
  const defaultModelBase = splitModelVariant(defaultModel ?? "", profile.modelVariants).baseModelId;
  const allModels = catalogs.flatMap((catalog) => catalog.models.flatMap((model) =>
    model.toolUseUnavailableReason ? [] : [{
      value: modelValue(catalog.connection.id, model.id),
      label: model.name,
      detail: `${catalog.connection.name} · ${model.id}`,
    }]
  ));
  const modelReady = Boolean(
    connectionId && defaultModel && defaultConnectionId === connectionId &&
    selectedCatalog?.models.some((model) =>
      !model.toolUseUnavailableReason && (model.id === defaultModel || model.id === defaultModelBase)
    ),
  );
  const pendingCount = Object.values(sectionStates).filter((state) => state === "pending").length;

  useEffect(() => {
    if (addingConnection) return;
    const selected = connections.find((item) => item.id === connectionId);
    if (!selected) return;
    setProviderId(selected.providerId);
    setName(selected.name);
    setBaseUrl(selected.baseUrl);
  }, [addingConnection, connectionId, connections]);

  useEffect(() => {
    if (!addingConnection) setConnectionId(defaultConnectionId);
  }, [defaultConnectionId]);

  useEffect(() => {
    setSectionStates((current) => ({
      ...current,
      model: modelReady ? "done" : "pending",
    }));
  }, [modelReady]);

  useEffect(() => {
    if (openSection !== "web" || webEnabled || webBackend !== "ddg") return;
    const providerBackend = PROVIDER_WEB_BACKENDS[connection?.providerId ?? ""];
    if (providerBackend) onWebBackend(providerBackend);
  }, [connection?.providerId, onWebBackend, openSection, webBackend, webEnabled]);

  const sections = useMemo(() => ([
    {
      id: "model" as const,
      label: "Model connection",
      summary: modelReady
        ? `${connection?.name ?? "Provider"} · ${defaultModel}`
        : "Required · connect a provider and choose a model",
    },
    {
      id: "appearance" as const,
      label: "Appearance",
      summary: THEMES.find((theme) => theme.id === themeId)?.name ?? "Choose a theme",
    },
    {
      id: "web" as const,
      label: "Web access",
      summary: webEnabled
        ? WEB_BACKENDS.find((backend) => backend.id === webBackend)?.label ?? "Enabled"
        : "Off · optional",
    },
    {
      id: "subagent" as const,
      label: "Subagents",
      summary: subagent.enabled
        ? subagent.modelMode === "main" ? "Use main conversation model" : subagent.model || "Choose a model"
        : "Off · optional",
    },
  ]), [connection?.name, defaultModel, modelReady, subagent, themeId, webBackend, webEnabled]);

  async function connect(): Promise<void> {
    setProviderBusy(true);
    setProviderStatus(null);
    setMessage(null);
    try {
      const result = await onConnect({
        id: addingConnection ? "" : connectionId,
        providerId: profile.id,
        name: name.trim() || profile.name,
        baseUrl: baseUrl.trim() || profile.defaultBaseUrl,
        enabled: true,
        requestLimit: connection?.requestLimit ?? profile.defaultRequestLimit ?? 1,
        manualModels: connection?.manualModels ?? [],
        ...(profile.apiKey !== "none" && apiKey ? { apiKey } : {}),
      });
      setConnectionId(result.connectionId);
      setAddingConnection(false);
      setApiKey("");
      setProviderStatus(result.status);
      setProviderConnected(result.connected);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setProviderBusy(false);
    }
  }

  async function finish(): Promise<void> {
    if (!modelReady || pendingCount > 0) return;
    setFinishing(true);
    setMessage(null);
    try {
      await onComplete();
    } catch (cause) {
      setMessage(errorMessage(cause));
      setFinishing(false);
    }
  }

  function resolveSection(section: Exclude<Section, "model">, state: "done" | "skipped"): void {
    const next = { ...sectionStates, [section]: state };
    setSectionStates(next);
    const nextSection = (["model", "appearance", "web", "subagent"] as const)
      .find((item) => next[item] === "pending");
    setOpenSection(nextSection ?? null);
  }

  function skipOptionalSetup(): void {
    setSectionStates((current) => ({
      ...current,
      appearance: "skipped",
      web: "skipped",
      subagent: "skipped",
    }));
    setOpenSection(modelReady ? null : "model");
  }

  async function useManualModel(): Promise<void> {
    if (!connection || !manualModel.trim()) return;
    setManualModelBusy(true);
    setMessage(null);
    try {
      await onManualModel(connection, manualModel.trim());
      setManualModel("");
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setManualModelBusy(false);
    }
  }

  function setSubagentMode(mode: "off" | "primary" | "other"): void {
    if (mode === "off") {
      onSubagent({ ...subagent, enabled: false });
      return;
    }
    if (mode === "primary") {
      onSubagent({
        ...subagent,
        enabled: true,
        modelMode: "main",
        providerConnectionId: "",
        model: "",
      });
      return;
    }
    onSubagent({
      ...subagent,
      enabled: true,
      modelMode: "fixed",
      providerConnectionId: "",
      model: "",
    });
  }

  const subagentMode = !subagent.enabled
    ? "off"
    : subagent.modelMode === "main"
      ? "primary"
      : "other";
  const webInfo = WEB_BACKENDS.find((backend) => backend.id === webBackend)!;
  const keyedWebBackend = webBackend !== "ddg" && webBackend !== "openrouter" && webBackend !== "deepseek"
    ? webBackend
    : null;

  return (
    <main className="onboarding-shell">
      <div className="onboarding-glow one" aria-hidden="true" />
      <div className="onboarding-glow two" aria-hidden="true" />
      <section className="onboarding-card" aria-label={`${PROJECT.name} setup`}>
        {dismissible ? (
          <button className="onboarding-close" type="button" onClick={onDismiss} aria-label="Close setup">×</button>
        ) : null}
        <header className="onboarding-heading">
          <span className="onboarding-mark" aria-hidden="true">
            <img src={logoUrl} alt="" />
          </span>
          <div>
            <p>Welcome to {PROJECT.name}</p>
            <h1>Set up your workspace</h1>
            <span>Four small choices. You can change all of them later.</span>
          </div>
        </header>

        <div className="onboarding-sections">
          {sections.map((section, index) => (
            <section className={openSection === section.id ? "onboarding-section open" : "onboarding-section"} key={section.id}>
              <button
                className="onboarding-summary"
                type="button"
                aria-expanded={openSection === section.id}
                onClick={() => setOpenSection((current) => current === section.id ? null : section.id)}
              >
                <span className={`onboarding-step ${sectionStates[section.id]}`}>
                  {sectionStates[section.id] === "done"
                    ? "✓"
                    : sectionStates[section.id] === "skipped" ? "–" : index + 1}
                </span>
                <span className="onboarding-summary-copy">
                  <strong>{section.label}</strong>
                  <small>{section.summary}</small>
                </span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
              </button>

              <div className="onboarding-reveal"><div className="onboarding-reveal-inner"><div className="onboarding-body">
                {section.id === "model" ? (
                  <>
                    <label className="onboarding-field">
                      <span>Connection</span>
                      <select
                        value={addingConnection ? `new:${providerId}` : connectionId}
                        onChange={(event) => {
                          if (event.target.value.startsWith("new:")) {
                            const nextProfile = providerProfile(event.target.value.slice(4));
                            setAddingConnection(true);
                            setProviderId(nextProfile.id);
                            setName(nextProfile.name);
                            setBaseUrl(nextProfile.defaultBaseUrl);
                            setApiKey("");
                          } else {
                            setAddingConnection(false);
                            setConnectionId(event.target.value);
                          }
                          setProviderStatus(null);
                        }}
                      >
                        <optgroup label="Configured">
                          {connections.filter((item) => item.enabled).map((item) => (
                            <option value={item.id} key={item.id}>{item.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Add connection">
                          {PROVIDER_PROFILES.map((item) => (
                            <option value={`new:${item.id}`} key={item.id}>Add {item.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </label>

                    {!profile.fixedBaseUrl ? (
                      <label className="onboarding-field">
                        <span>Endpoint</span>
                        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                      </label>
                    ) : null}

                    {profile.apiKey !== "none" ? (
                      <label className="onboarding-field">
                        <span>API key</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={apiKey}
                          placeholder={connection?.hasApiKey ? "Configured · enter a new key to replace it" : "Paste API key"}
                          onChange={(event) => setApiKey(event.target.value)}
                        />
                      </label>
                    ) : null}

                    <div className="onboarding-inline-actions">
                      <button
                        className="onboarding-secondary"
                        type="button"
                        disabled={providerBusy || (profile.apiKey === "required" && !apiKey && !connection?.hasApiKey)}
                        onClick={() => void connect()}
                      >{providerBusy ? "Checking…" : "Save and check"}</button>
                      {providerStatus ? (
                        <span className={providerConnected ? "onboarding-status success" : "onboarding-status danger"}>
                          {providerConnected ? "✓ " : ""}{providerStatus.message}
                        </span>
                      ) : null}
                    </div>

                    {loadingModels ? <p className="onboarding-note">Discovering models…</p> : null}
                    {!loadingModels && selectedCatalog && selectedCatalog.models.length === 0 ? (
                      <div className="onboarding-manual-model">
                        <label className="onboarding-field">
                          <span>Model ID</span>
                          <input
                            value={manualModel}
                            placeholder="Model ID used by this endpoint"
                            onChange={(event) => setManualModel(event.target.value)}
                          />
                        </label>
                        <div className="onboarding-inline-actions">
                          <button
                            className="onboarding-secondary"
                            type="button"
                            disabled={!manualModel.trim() || manualModelBusy}
                            onClick={() => void useManualModel()}
                          >{manualModelBusy ? "Saving…" : "Use model"}</button>
                          <span className="onboarding-status">This provider could not list its models.</span>
                        </div>
                      </div>
                    ) : null}
                    {selectedCatalog?.error ? <p className="onboarding-note danger">{selectedCatalog.error}</p> : null}
                    {selectedModelError ? <p className="onboarding-note danger">{selectedModelError}</p> : null}
                    {modelReady ? (
                      <div className="onboarding-decision">
                        <button
                          className="onboarding-secondary"
                          type="button"
                          onClick={() => setOpenSection(
                            (["appearance", "web", "subagent"] as const)
                              .find((item) => sectionStates[item] === "pending") ?? null,
                          )}
                        >Continue</button>
                      </div>
                    ) : null}
                  </>
                ) : section.id === "appearance" ? (
                  <>
                    <div className="onboarding-themes">
                      {THEMES.map((theme) => (
                        <button
                          className={theme.id === themeId ? "onboarding-theme selected" : "onboarding-theme"}
                          type="button"
                          key={theme.id}
                          onClick={() => onTheme(theme.id)}
                          aria-pressed={theme.id === themeId}
                        >
                          <span className="onboarding-theme-preview" style={{ background: theme.colors.background }}>
                            <i style={{ background: theme.colors.panel }} />
                            <i style={{ background: theme.colors.surface }} />
                            <i style={{ background: theme.colors.primary }} />
                          </span>
                          <span>{theme.name}</span>
                          <b aria-hidden="true">{theme.id === themeId ? "✓" : ""}</b>
                        </button>
                      ))}
                    </div>
                    <SectionDecision
                      onDone={() => resolveSection("appearance", "done")}
                      onSkip={() => resolveSection("appearance", "skipped")}
                    />
                  </>
                ) : section.id === "web" ? (
                  <>
                    <label className="onboarding-choice">
                      <span><strong>Give models web access</strong><small>Search, direct page fetching, and supported video transcripts.</small></span>
                      <input
                        className="selection-checkbox"
                        type="checkbox"
                        checked={webEnabled}
                        onChange={(event) => onWebEnabled(event.target.checked)}
                      />
                    </label>
                    {webEnabled ? (
                      <>
                        <label className="onboarding-field">
                          <span>Search connection</span>
                          <select value={webBackend} onChange={(event) => onWebBackend(event.target.value as WebSearchBackend)}>
                            {WEB_BACKENDS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                          </select>
                        </label>
                        <p className="onboarding-note">{webInfo.description}</p>
                        {keyedWebBackend ? (
                          <div className="onboarding-key-row">
                            <input
                              type="password"
                              value={webApiKey}
                              placeholder={webKeyBackends.includes(keyedWebBackend) ? "API key configured" : `${webInfo.label} API key`}
                              onChange={(event) => setWebApiKey(event.target.value)}
                            />
                            <button
                              className="onboarding-secondary"
                              type="button"
                              disabled={!webApiKey.trim()}
                              onClick={() => void onWebKey(keyedWebBackend, webApiKey.trim()).then(() => setWebApiKey(""))}
                            >Save key</button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    <SectionDecision
                      onDone={() => resolveSection("web", "done")}
                      onSkip={() => resolveSection("web", "skipped")}
                    />
                  </>
                ) : (
                  <>
                    <div className="onboarding-segmented" role="group" aria-label="Subagent behavior">
                      <button className={subagentMode === "off" ? "active" : ""} type="button" onClick={() => setSubagentMode("off")}>Off</button>
                      <button className={subagentMode === "primary" ? "active" : ""} type="button" disabled={!modelReady} onClick={() => setSubagentMode("primary")}>Use primary model</button>
                      <button className={subagentMode === "other" ? "active" : ""} type="button" disabled={!allModels.length} onClick={() => setSubagentMode("other")}>Choose another</button>
                    </div>
                    {subagentMode === "other" ? (
                      <div className="onboarding-field">
                        <span>Subagent model</span>
                        <SearchPicker
                          value={modelValue(subagent.providerConnectionId, subagent.model)}
                          options={allModels}
                          placeholder="Choose a model"
                          searchPlaceholder="Search providers and models…"
                          onChange={(value) => {
                            const [providerConnectionId, model] = value.split("\n");
                            onSubagent({
                              ...subagent,
                              enabled: true,
                              modelMode: "fixed",
                              providerConnectionId: providerConnectionId ?? "",
                              model: model ?? "",
                            });
                          }}
                        />
                      </div>
                    ) : null}
                    <p className="onboarding-note">Subagents stay out of ordinary model requests until you activate them.</p>
                    <SectionDecision
                      onDone={() => resolveSection("subagent", "done")}
                      onSkip={() => resolveSection("subagent", "skipped")}
                    />
                  </>
                )}
              </div></div></div>
            </section>
          ))}
        </div>

        {message ? <p className="onboarding-message" role="alert">{message}</p> : null}

        <footer className="onboarding-footer">
          <div className="onboarding-progress">
            {pendingCount === 0 ? <span>Ready when you are.</span> : null}
            {pendingCount > (modelReady ? 0 : 1) ? (
              <button type="button" onClick={skipOptionalSetup}>Skip (Set up later in settings)</button>
            ) : null}
          </div>
          <button className="onboarding-primary" type="button" disabled={!modelReady || pendingCount > 0 || finishing} onClick={() => void finish()}>
            {finishing ? "Finishing…" : `Enter ${PROJECT.name}`} <span aria-hidden="true">→</span>
          </button>
        </footer>
      </section>
    </main>
  );
}

function SectionDecision({
  onDone,
  onSkip,
}: {
  onDone(): void;
  onSkip(): void;
}): JSX.Element {
  return (
    <div className="onboarding-decision">
      <button className="onboarding-skip" type="button" onClick={onSkip}>Skip for now</button>
      <button className="onboarding-secondary" type="button" onClick={onDone}>Done</button>
    </div>
  );
}

function modelValue(connectionId: string, model: string): string {
  return connectionId && model ? `${connectionId}\n${model}` : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
