import { useEffect, useRef, useState } from "react";
import type {
  ProviderConnection,
  ProviderConnectionInput,
  ProviderModel,
  ProviderStatus,
} from "../../../../providers/provider.js";
import { PROVIDER_PROFILES, providerProfile } from "../../../../providers/profiles.js";

const NEW_CONNECTION = "new";

export function ProviderSettings({
  connections,
  error,
  onSave,
  onRemove,
  onTest,
}: {
  connections: ProviderConnection[];
  error: string | null;
  onSave(input: ProviderConnectionInput): Promise<void>;
  onRemove(id: string): Promise<void>;
  onTest(id: string): Promise<ProviderStatus>;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState(connections[0]?.id ?? NEW_CONNECTION);
  const [draft, setDraft] = useState(() => connectionDraft(connections[0]));
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const connectionsBeforeSave = useRef<Set<string> | null>(null);
  const profile = providerProfile(draft.providerId);

  const visibleConnections = connections.filter((connection) => {
    const search = query.trim().toLowerCase();
    return !search || connection.name.toLowerCase().includes(search)
      || providerName(connection.providerId).toLowerCase().includes(search);
  });

  useEffect(() => {
    if (selectedId === NEW_CONNECTION && connectionsBeforeSave.current) {
      const added = connections.find((item) => !connectionsBeforeSave.current?.has(item.id));
      connectionsBeforeSave.current = null;
      if (added) {
        select(added.id);
        return;
      }
    }
    const connection = connections.find((item) => item.id === selectedId);
    if (connection) setDraft(connectionDraft(connection));
    else if (selectedId !== NEW_CONNECTION) select(connections[0]?.id ?? NEW_CONNECTION);
  }, [connections]);

  function select(id: string): void {
    setSelectedId(id);
    setDraft(connectionDraft(connections.find((item) => item.id === id)));
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
    };
  }

  async function save(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      if (selectedId === NEW_CONNECTION) {
        connectionsBeforeSave.current = new Set(connections.map((connection) => connection.id));
      }
      await onSave({ ...connectionInput(), ...(apiKey ? { apiKey } : {}) });
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

  return (
    <section className="settings view-enter" aria-label="Provider settings">
      <div className="settings-content provider-settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Providers</h1>
        <p className="settings-description">Connect hosted or local model endpoints.</p>

        <button className="provider-add" type="button" onClick={() => select(NEW_CONNECTION)}>
          <span aria-hidden="true">+</span>
          Add new provider
        </button>

        <details className="provider-picker">
          <summary className="provider-picker-summary">
            <span className={draft.enabled ? "provider-dot" : "provider-dot disabled"} />
            <span className="provider-row-copy">
              <strong>{selectedId === NEW_CONNECTION ? "New provider" : draft.name}</strong>
              <small>{providerName(draft.providerId)}{selectedId === NEW_CONNECTION ? "" : ` · ${draft.enabled ? draft.hasApiKey ? "Key configured" : "No key" : "Disabled"}`}</small>
            </span>
            <svg className="provider-picker-caret" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </summary>
          <div className="provider-picker-menu">
            {connections.length > 5 ? (
              <label className="provider-search">
                <span className="sr-only">Search connections</span>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" />
                  <path d="m13 13 4 4" />
                </svg>
                <input
                  value={query}
                  placeholder="Search connections"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            ) : null}
            <div className="provider-connections" role="list">
              {visibleConnections.map((connection) => (
                <button
                  className={selectedId === connection.id ? "active" : ""}
                  type="button"
                  role="listitem"
                  key={connection.id}
                  onClick={(event) => {
                    select(connection.id);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  <span className={connection.enabled ? "provider-dot" : "provider-dot disabled"} />
                  <span className="provider-row-copy">
                    <strong>{connection.name}</strong>
                    <small>{providerName(connection.providerId)} · {connection.enabled ? connection.hasApiKey ? "Key configured" : "No key" : "Disabled"}</small>
                  </span>
                </button>
              ))}
              {!visibleConnections.length ? <p className="provider-empty">No matching connections</p> : null}
            </div>
          </div>
        </details>

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

            <div className="setting-field provider-models-setting">
              <span className="provider-models-copy">
                <strong>Manual models</strong>
                <small>Useful when this connection cannot discover its own models.</small>
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
                >+ Add model</button>
              </div>
            </div>

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
              <button className="primary" type="button" disabled={busy} onClick={() => void save()}>Save</button>
              <button type="button" disabled={busy || selectedId === NEW_CONNECTION} onClick={() => void test()}>Test connection</button>
              {selectedId !== NEW_CONNECTION && draft.hasApiKey ? (
                <button type="button" disabled={busy} onClick={() => void removeKey()}>Remove stored key</button>
              ) : null}
              {selectedId !== NEW_CONNECTION && selectedId !== "openrouter" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRemove(selectedId)
                    .then(() => select(connections[0]?.id ?? NEW_CONNECTION))
                    .catch((cause) => setStatus({ message: errorMessage(cause) }))}
                >Remove</button>
              ) : null}
            </div>
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

type ConnectionDraft = {
  providerId: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
  models: ProviderModel[];
};

function connectionDraft(connection?: ProviderConnection): ConnectionDraft {
  return connection ? {
    providerId: connection.providerId,
    name: connection.name,
    baseUrl: connection.baseUrl,
    enabled: connection.enabled,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
