import { useEffect, useRef, useState } from "react";
import type {
  ProviderConnection,
  ProviderConnectionInput,
  ProviderCatalog,
  ProviderModel,
  ProviderStatus,
} from "../../../../providers/provider.js";
import { PROVIDER_PROFILES, providerProfile } from "../../../../providers/profiles.js";

const NEW_CONNECTION = "new";

export function ProviderSettings({
  connections,
  catalogs,
  loadingCatalogs,
  error,
  onSave,
  onRemove,
  onTest,
}: {
  connections: ProviderConnection[];
  catalogs: ProviderCatalog[];
  loadingCatalogs: boolean;
  error: string | null;
  onSave(input: ProviderConnectionInput): Promise<void>;
  onRemove(id: string): Promise<void>;
  onTest(id: string): Promise<ProviderStatus>;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(() => connectionDraft());
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const connectionsBeforeSave = useRef<Set<string> | null>(null);
  const profile = providerProfile(draft.providerId);
  const catalog = catalogs.find((item) => item.connection.id === selectedId);
  const fallbackCatalogs = catalogs.filter((item) =>
    item.connection.enabled && item.connection.id !== selectedId && item.models.length,
  );
  const fallbackCatalog = fallbackCatalogs.find((item) =>
    item.connection.id === draft.fallbackProviderConnectionId
  );
  const usesFallback = Boolean(draft.fallbackProviderConnectionId && draft.fallbackModel);

  useEffect(() => {
    if (selectedId === NEW_CONNECTION && connectionsBeforeSave.current) {
      const added = connections.find((item) => !connectionsBeforeSave.current?.has(item.id));
      connectionsBeforeSave.current = null;
      if (added) {
        select(added.id);
        return;
      }
    }
    if (!selectedId) return;
    const connection = connections.find((item) => item.id === selectedId);
    if (connection) setDraft(connectionDraft(connection));
    else if (selectedId !== NEW_CONNECTION) collapse();
  }, [connections]);

  function select(id: string): void {
    setSelectedId(id);
    setDraft(connectionDraft(connections.find((item) => item.id === id)));
    setApiKey("");
    setStatus(null);
  }

  function collapse(): void {
    setSelectedId("");
    setDraft(connectionDraft());
    setApiKey("");
    setStatus(null);
  }

  function connectionInput(): ProviderConnectionInput {
    return {
      id: selectedId === NEW_CONNECTION ? "" : selectedId,
      providerId: draft.providerId,
      name: draft.name,
      baseUrl: draft.baseUrl,
      enabled: draft.enabled,
      requestLimit: draft.requestLimit,
      fallbackProviderConnectionId: draft.fallbackProviderConnectionId,
      fallbackModel: draft.fallbackModel,
      manualModels: draft.models.flatMap((model) => {
        const id = model.id.trim();
        if (!id) return [];
        return [{
          ...model,
          id,
          name: model.name.trim() || id,
          contextLength: model.contextLength > 0 ? model.contextLength : 128_000,
          inputModalities: model.inputModalities.length ? model.inputModalities : ["text"],
        }];
      }),
      ...(profile.apiKey !== "none" && apiKey ? { apiKey } : {}),
    };
  }

  async function save(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      if (selectedId === NEW_CONNECTION) {
        connectionsBeforeSave.current = new Set(connections.map((connection) => connection.id));
      }
      await onSave(connectionInput());
      setApiKey("");
      setStatus({ message: "Saved" });
    } catch (cause) {
      connectionsBeforeSave.current = null;
      setStatus({ message: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await onSave({ ...connectionInput(), apiKey: "" });
      setApiKey("");
      setStatus({ message: "Stored key removed" });
    } catch (cause) {
      setStatus({ message: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    if (selectedId === NEW_CONNECTION) return;
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await onTest(selectedId));
    } catch (cause) {
      setStatus({ message: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  function updateModel(index: number, change: Partial<ProviderModel>): void {
    setDraft({
      ...draft,
      models: draft.models.map((model, modelIndex) => modelIndex === index
        ? { ...model, ...change }
        : model),
    });
  }

  const providerEditor = (
    <div className="provider-detail">
          <label className="setting-field">
              <span><strong>Type</strong><small>{profile.description}</small></span>
              <select
                value={draft.providerId}
                disabled={selectedId !== NEW_CONNECTION}
                onChange={(event) => {
                  const providerId = event.target.value;
                  const nextProfile = providerProfile(providerId);
                  setDraft((value) => ({
                    ...value,
                    providerId,
                    name: nextProfile.name,
                    baseUrl: nextProfile.defaultBaseUrl,
                    requestLimit: nextProfile.defaultRequestLimit ?? 1,
                  }));
                }}
              >
                {PROVIDER_PROFILES.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
          </label>

            <label className="setting-field text-setting">
              <span><strong>Name</strong><small>The label shown in model selection and usage history.</small></span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>

            <label className="setting-field text-setting">
              <span>
                <strong>Base URL</strong>
                <small>{profile.baseUrlHint}</small>
              </span>
              <input
                value={draft.baseUrl}
                disabled={profile.fixedBaseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </label>

            {profile.apiKey !== "none" ? (
              <label className="setting-field text-setting">
                <span>
                  <strong>API key</strong>
                  <small>{draft.hasApiKey
                    ? "A key is configured. Enter a new value to replace it."
                    : profile.apiKey === "required" ? "Required for this provider." : "Optional for local endpoints."}</small>
                </span>
                <input
                  type="password"
                  value={apiKey}
                  autoComplete="off"
                  placeholder={draft.hasApiKey ? "••••••••••••" : "Optional"}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
            ) : null}

            <DiscoveryStatus
              isNew={selectedId === NEW_CONNECTION}
              loading={loadingCatalogs}
              catalog={catalog}
            />

            {selectedId !== NEW_CONNECTION ? <div className="setting-field provider-models-setting">
              <span className="provider-models-copy">
                <strong>Manual models</strong>
                <small>Optional fallback when this connection cannot discover its own models.</small>
              </span>
              <div className="provider-model-editor">
                {draft.models.map((model, index) => (
                  <div className="provider-model-row" key={index}>
                    <label className="provider-model-cell">
                      <span>Model ID</span>
                      <input
                        placeholder="local-model"
                        value={model.id}
                        onChange={(event) => updateModel(index, { id: event.target.value })}
                      />
                    </label>
                    <label className="provider-model-cell">
                      <span>Display name</span>
                      <input
                        placeholder="Local model"
                        value={model.name}
                        onChange={(event) => updateModel(index, { name: event.target.value })}
                      />
                    </label>
                    <label className="provider-model-cell">
                      <span>Context size</span>
                      <input
                        type="number"
                        min="1"
                        placeholder="128000"
                        value={model.contextLength || ""}
                        onChange={(event) => updateModel(index, { contextLength: Number(event.target.value) })}
                      />
                    </label>
                    <label className="provider-model-cell">
                      <span>Modalities</span>
                      <select
                        value={model.inputModalities.includes("image") ? "text,image" : "text"}
                        onChange={(event) => updateModel(index, {
                          inputModalities: event.target.value.split(","),
                        })}
                      >
                        <option value="text">Text</option>
                        <option value="text,image">Text and images</option>
                      </select>
                    </label>
                    <button
                      className="provider-model-remove"
                      type="button"
                      aria-label={`Remove model ${index + 1}`}
                      onClick={() => setDraft({
                        ...draft,
                        models: draft.models.filter((_, modelIndex) => modelIndex !== index),
                      })}
                    >×</button>
                  </div>
                ))}
                <button
                  className="provider-model-add"
                  type="button"
                  onClick={() => setDraft({ ...draft, models: [...draft.models, emptyModel()] })}
                >+ Add manually</button>
              </div>
            </div> : null}

            <details className="provider-advanced">
              <summary>Advanced</summary>
              <label className="setting-field text-setting">
                <span>
                  <strong>Concurrent requests</strong>
                  <small>Shared by every main conversation and subagent using this connection.</small>
                </span>
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={draft.requestLimit}
                  onChange={(event) => setDraft({
                    ...draft,
                    requestLimit: Math.max(1, Math.min(16, Number(event.target.value) || 1)),
                  })}
                />
              </label>

              <label className="setting-field">
                <span>
                  <strong>When full</strong>
                  <small>Wait normally, or route new turns and subagents to another model.</small>
                </span>
                <select
                  value={usesFallback ? "fallback" : "wait"}
                  onChange={(event) => {
                    const fallback = fallbackCatalogs[0];
                    const model = fallback?.models[0];
                    setDraft(event.target.value === "fallback" && fallback
                      ? {
                          ...draft,
                          fallbackProviderConnectionId: fallback.connection.id,
                          fallbackModel: model?.id ?? "",
                        }
                      : { ...draft, fallbackProviderConnectionId: "", fallbackModel: "" });
                  }}
                >
                  <option value="wait">Wait for availability</option>
                  <option value="fallback" disabled={!fallbackCatalogs.length}>Use fallback provider</option>
                </select>
              </label>

              {usesFallback ? (
                <label className="setting-field">
                  <span>
                    <strong>Fallback provider</strong>
                    <small>Receives new work only while this connection is full.</small>
                  </span>
                  <select
                    value={draft.fallbackProviderConnectionId}
                    onChange={(event) => {
                      const next = fallbackCatalogs.find((item) => item.connection.id === event.target.value);
                      setDraft({
                        ...draft,
                        fallbackProviderConnectionId: next?.connection.id ?? "",
                        fallbackModel: next?.models[0]?.id ?? "",
                      });
                    }}
                  >
                    {fallbackCatalogs.map((item) => (
                      <option key={item.connection.id} value={item.connection.id}>{item.connection.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              {usesFallback ? (
                <label className="setting-field">
                  <span>
                    <strong>Fallback model</strong>
                    <small>Used through the selected fallback provider.</small>
                  </span>
                  <select
                    value={draft.fallbackModel}
                    onChange={(event) => setDraft({ ...draft, fallbackModel: event.target.value })}
                  >
                    {fallbackCatalog?.models.map((model) => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </details>

            <label className="setting-field text-setting">
              <span><strong>Enabled</strong><small>Disabled connections are hidden from model selection.</small></span>
              <input
                className="selection-checkbox"
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
            </label>

            {status ? (
              <p className="provider-status">
                <strong>{status.message}</strong>
                {status.details?.map((detail) => <span key={detail.label}>{detail.label} {detail.value}</span>)}
              </p>
            ) : null}

            <div className="editor-actions provider-actions">
              <button className="primary" type="button" disabled={busy} onClick={() => void save()}>
                {selectedId === NEW_CONNECTION ? "Save and discover" : "Save"}
              </button>
              {selectedId !== NEW_CONNECTION ? (
                <button type="button" disabled={busy} onClick={() => void test()}>
                  {catalog?.error && draft.models.length ? "Test manual model" : "Test connection"}
                </button>
              ) : null}
              {selectedId !== NEW_CONNECTION && draft.hasApiKey ? (
                <button type="button" disabled={busy} onClick={() => void removeKey()}>Remove stored key</button>
              ) : null}
              {selectedId !== NEW_CONNECTION && selectedId !== "openrouter" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRemove(selectedId)
                    .then(collapse)
                    .catch((cause) => setStatus({ message: errorMessage(cause) }))}
                >Remove</button>
              ) : null}
            </div>
    </div>
  );

  return (
    <section className="settings view-enter" aria-label="Provider settings">
      <div className="settings-content provider-settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Providers</h1>
        <p className="settings-description">Connect hosted or local model endpoints.</p>

        <button className="provider-add" type="button" onClick={() => select(NEW_CONNECTION)}>
          <span aria-hidden="true">+</span>
          Add provider
        </button>

        <div className="provider-accordion-list">
          {selectedId === NEW_CONNECTION ? (
            <section className="provider-accordion open">
              <button
                className="provider-accordion-summary"
                type="button"
                aria-expanded="true"
                onClick={collapse}
              >
                <span className="provider-dot pending" />
                <span className="provider-row-copy">
                  <strong>New provider</strong>
                  <small>Configure a hosted or local connection</small>
                </span>
                <ProviderCaret />
              </button>
              <div className="provider-accordion-reveal">{providerEditor}</div>
            </section>
          ) : null}

          {connections.map((connection) => {
            const open = selectedId === connection.id;
            return (
              <section className={open ? "provider-accordion open" : "provider-accordion"} key={connection.id}>
                <button
                  className="provider-accordion-summary"
                  type="button"
                  aria-expanded={open}
                  onClick={() => open ? collapse() : select(connection.id)}
                >
                  <span className={connection.enabled ? "provider-dot" : "provider-dot disabled"} />
                  <span className="provider-row-copy">
                    <strong>{connection.name}</strong>
                    <small>{providerName(connection.providerId)} · {connectionStatus(connection.providerId, connection.hasApiKey, connection.enabled)}</small>
                  </span>
                  <ProviderCaret />
                </button>
                {open ? <div className="provider-accordion-reveal">{providerEditor}</div> : null}
              </section>
            );
          })}
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function ProviderCaret(): JSX.Element {
  return (
    <svg className="provider-accordion-caret" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function DiscoveryStatus({
  isNew,
  loading,
  catalog,
}: {
  isNew: boolean;
  loading: boolean;
  catalog: ProviderCatalog | undefined;
}): JSX.Element {
  let title = "Model discovery has not run";
  let detail = "Save this provider to check its model catalog.";
  let tone = "pending";

  if (!isNew && loading && !catalog) {
    title = "Checking model discovery…";
    detail = "Snaffle is asking this connection for its available models.";
  } else if (catalog?.error) {
    title = "Model discovery unavailable";
    detail = catalog.error;
    tone = "error";
  } else if (catalog) {
    const count = catalog.discoveredModelCount;
    title = count ? `${count} model${count === 1 ? "" : "s"} discovered automatically` : "No models discovered";
    detail = count
      ? "Manual model entries are optional."
      : "Load a model in the server or add one manually below.";
    tone = count ? "success" : "pending";
  }

  return (
    <div className={`provider-discovery ${tone}`} role="status">
      <span className="provider-discovery-dot" aria-hidden="true" />
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  );
}

type ConnectionDraft = {
  providerId: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  requestLimit: number;
  fallbackProviderConnectionId: string;
  fallbackModel: string;
  hasApiKey: boolean;
  models: ProviderModel[];
};

function connectionDraft(connection?: ProviderConnection): ConnectionDraft {
  return connection ? {
    providerId: connection.providerId,
    name: connection.name,
    baseUrl: connection.baseUrl,
    enabled: connection.enabled,
    requestLimit: connection.requestLimit,
    fallbackProviderConnectionId: connection.fallbackProviderConnectionId,
    fallbackModel: connection.fallbackModel,
    hasApiKey: connection.hasApiKey,
    models: connection.manualModels.map((model) => ({
      ...model,
      inputModalities: [...model.inputModalities],
    })),
  } : {
    providerId: "openai-compatible",
    name: "Local model",
    baseUrl: "http://localhost:8080/v1",
    enabled: true,
    requestLimit: 1,
    fallbackProviderConnectionId: "",
    fallbackModel: "",
    hasApiKey: false,
    models: [],
  };
}

function emptyModel(): ProviderModel {
  return {
    id: "",
    name: "",
    contextLength: 128_000,
    inputModalities: ["text"],
  };
}

function providerName(providerId: string): string {
  return providerProfile(providerId).name;
}

function connectionStatus(providerId: string, hasApiKey: boolean, enabled: boolean): string {
  if (!enabled) return "Disabled";
  if (providerProfile(providerId).apiKey === "none") return "No key needed";
  return hasApiKey ? "Key configured" : "No key";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
