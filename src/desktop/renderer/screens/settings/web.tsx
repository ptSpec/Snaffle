import { useEffect, useState } from "react";
import type { KetchSearchBackend, WebSearchBackend } from "../../../../tools/web/types.js";

export function WebSettings({
  backend,
  configuredBackends,
  enabled,
  ketchAvailable,
  openRouterAvailable,
  error,
  onEnabled,
  onBackend,
  onSave,
}: {
  backend: WebSearchBackend;
  configuredBackends: KetchSearchBackend[];
  enabled: boolean;
  ketchAvailable: boolean;
  openRouterAvailable: boolean;
  error: string | null;
  onEnabled: (enabled: boolean) => void;
  onBackend: (backend: WebSearchBackend) => void;
  onSave: (backend: KetchSearchBackend, apiKey: string) => void;
}): JSX.Element {
  const [apiKey, setApiKey] = useState("");
  const info = WEB_BACKENDS.find((item) => item.id === backend)!;
  const ketchBackend = backend === "openrouter" ? undefined : backend;
  const configured = ketchBackend ? configuredBackends.includes(ketchBackend) : openRouterAvailable;

  useEffect(() => setApiKey(""), [backend]);

  return (
    <section className="settings view-enter" aria-label="Web settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Web</h1>
        <p className="settings-description">Choose one search connection. Direct providers run through bundled Ketch and return source results. OpenRouter Research returns a smaller synthesized answer and uses additional model tokens.</p>

        <label className="setting-field text-setting">
          <span>
            <strong>Web tools</strong>
            <small>Expose search, direct page fetching, and YouTube transcripts to the model.</small>
          </span>
          <input
            className="selection-checkbox"
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabled(event.target.checked)}
          />
        </label>

        <label className="setting-field">
          <span>
            <strong>Search connection</strong>
            <small>{info.description}</small>
          </span>
          <select value={backend} onChange={(event) => onBackend(event.target.value as WebSearchBackend)}>
            {WEB_BACKENDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>

        {backend === "ddg" ? <p className="settings-warning" role="note">
          DuckDuckGo is frequently rate-limited and is not recommended for a reliable agent experience.
          Try Tavily instead—its free tier includes 1,000 credits each month, enough for up to 1,000 basic searches.
        </p> : null}

        <div className="setting-field web-connection-status">
          <span>Connection status</span>
          <strong>{backend === "openrouter"
            ? openRouterAvailable ? "Ready · uses the existing OpenRouter key" : "OpenRouter key is unavailable"
            : ketchAvailable ? info.needsKey && !configured ? "API key required" : "Ready · powered by Ketch"
            : "Ketch is unavailable in this build"}</strong>
        </div>

        {ketchBackend && ketchBackend !== "ddg" ? <>
        <label className="setting-field text-setting">
          <span>
            <strong>{info.label} API key</strong>
            <small>{configured
              ? "Configured. Enter a new key to replace it."
              : info.needsKey ? "Required. The renderer and model never receive it." : "Optional. Public Exa search can work without one."}</small>
          </span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={configured ? "••••••••••••" : info.placeholder}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <div className="editor-actions web-actions">
          <button
            className="primary"
            type="button"
            disabled={!apiKey.trim()}
            onClick={() => {
              onSave(ketchBackend, apiKey.trim());
              setApiKey("");
            }}
          >Save key</button>
          <button type="button" disabled={!configured} onClick={() => onSave(ketchBackend, "")}>Remove key</button>
        </div>
        </> : null}

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

const WEB_BACKENDS: {
  id: WebSearchBackend;
  label: string;
  description: string;
  needsKey?: boolean;
  placeholder?: string;
}[] = [
  { id: "ddg", label: "DuckDuckGo", description: "Free direct results through Ketch. No API key required." },
  { id: "exa", label: "Exa", description: "Direct semantic search through Ketch. An API key is optional.", placeholder: "Exa API key" },
  { id: "tavily", label: "Tavily", description: "Direct search results through Ketch. Provider charges may apply.", needsKey: true, placeholder: "tvly-…" },
  { id: "brave", label: "Brave", description: "Direct web results through Ketch. Provider charges may apply.", needsKey: true, placeholder: "Brave API key" },
  { id: "firecrawl", label: "Firecrawl", description: "Direct search results through Ketch. Provider charges may apply.", needsKey: true, placeholder: "fc-…" },
  { id: "openrouter", label: "OpenRouter Research", description: "A small research model searches and returns a concise cited answer. Additional model charges apply." },
];
