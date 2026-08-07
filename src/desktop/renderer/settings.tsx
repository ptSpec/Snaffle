import { useEffect, useState } from "react";
import { THEMES } from "../themes/index.js";
import {
  FONT_OPTIONS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  type FontId,
} from "../typography.js";
import type { SettingsPage } from "./sidebar.js";
import type { KetchSearchBackend, WebSearchBackend } from "../../tools/web/types.js";
import type { CompactionMode } from "../../context/budget.js";

export function Settings({
  page,
  themeId,
  interfaceFont,
  primaryFont,
  secondaryFont,
  codeFont,
  interfaceFontScale,
  conversationFontScale,
  codeBlockFontSize,
  editorFontSize,
  editorCommand,
  editorArguments,
  maxSteps,
  providerTimeoutMinutes,
  providerRetries,
  compactionMode,
  compactionThreshold,
  ketchAvailable,
  openRouterAvailable,
  webSearchEnabled,
  webSearchBackend,
  webSearchKeyBackends,
  error,
  onSelectTheme,
  onTypography,
  onTypographyScale,
  onCodeBlockFontSize,
  onEditorFontSize,
  onEditorLauncher,
  onChooseEditor,
  onMaxSteps,
  onProviderTimeoutMinutes,
  onProviderRetries,
  onCompaction,
  onWebSearchEnabled,
  onWebSearchBackend,
  onWebSearchApiKey,
}: {
  page: SettingsPage;
  themeId: string;
  interfaceFont: FontId;
  primaryFont: FontId;
  secondaryFont: FontId;
  codeFont: FontId;
  interfaceFontScale: number;
  conversationFontScale: number;
  codeBlockFontSize: number;
  editorFontSize: number;
  editorCommand: string;
  editorArguments: string;
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
  compactionMode: CompactionMode;
  compactionThreshold: number;
  ketchAvailable: boolean;
  openRouterAvailable: boolean;
  webSearchEnabled: boolean;
  webSearchBackend: WebSearchBackend;
  webSearchKeyBackends: KetchSearchBackend[];
  error: string | null;
  onSelectTheme: (themeId: string) => void;
  onTypography: (interfaceFont: FontId, primary: FontId, secondary: FontId, code: FontId) => void;
  onTypographyScale: (role: "interface" | "conversation", value: number) => void;
  onCodeBlockFontSize: (size: number) => void;
  onEditorFontSize: (size: number) => void;
  onEditorLauncher: (command: string, argumentsTemplate: string) => void;
  onChooseEditor: () => void;
  onMaxSteps: (maxSteps: number) => void;
  onProviderTimeoutMinutes: (minutes: number) => void;
  onProviderRetries: (retries: number) => void;
  onCompaction: (mode: CompactionMode, threshold: number) => void;
  onWebSearchEnabled: (enabled: boolean) => void;
  onWebSearchBackend: (backend: WebSearchBackend) => void;
  onWebSearchApiKey: (backend: KetchSearchBackend, apiKey: string) => void;
}): JSX.Element {
  if (page === "context") {
    return (
      <ContextSettings
        mode={compactionMode}
        threshold={compactionThreshold}
        error={error}
        onChange={onCompaction}
      />
    );
  }

  if (page === "web") {
    return (
      <WebSettings
        backend={webSearchBackend}
        configuredBackends={webSearchKeyBackends}
        enabled={webSearchEnabled}
        ketchAvailable={ketchAvailable}
        openRouterAvailable={openRouterAvailable}
        error={error}
        onEnabled={onWebSearchEnabled}
        onBackend={onWebSearchBackend}
        onSave={onWebSearchApiKey}
      />
    );
  }

  if (page === "agent") {
    return (
      <AgentSettings
        maxSteps={maxSteps}
        providerTimeoutMinutes={providerTimeoutMinutes}
        providerRetries={providerRetries}
        error={error}
        onMaxSteps={onMaxSteps}
        onProviderTimeoutMinutes={onProviderTimeoutMinutes}
        onProviderRetries={onProviderRetries}
      />
    );
  }

  if (page === "editor") {
    return (
      <EditorSettings
        command={editorCommand}
        argumentsTemplate={editorArguments}
        error={error}
        onChange={onEditorLauncher}
        onChoose={onChooseEditor}
      />
    );
  }

  return (
    <section className="settings view-enter" aria-label="Settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Appearance</h1>
        <p className="settings-description">Choose how Esch looks.</p>

        <div className="theme-list">
          {THEMES.map((theme) => (
            <button
              className={theme.id === themeId ? "theme-option selected" : "theme-option"}
              type="button"
              key={theme.id}
              onClick={() => onSelectTheme(theme.id)}
              aria-pressed={theme.id === themeId}
            >
              <span className="theme-preview" aria-hidden="true">
                <span style={{ background: theme.colors.panel }} />
                <span style={{ background: theme.colors.background }} />
                <span style={{ background: theme.colors.surface }} />
                <span style={{ background: theme.colors.primary }} />
              </span>
              <span>{theme.name}</span>
              <span className="theme-check" aria-hidden="true">
                {theme.id === themeId ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>

        <div className="typography-settings">
          <section className="typography-card">
            <h2>Interface</h2>
            <FontSetting
              label="Font"
              description="Sidebars, controls, settings, and inspector text."
              value={interfaceFont}
              onChange={(value) => onTypography(value, primaryFont, secondaryFont, codeFont)}
            />
            <ScaleSetting
              value={interfaceFontScale}
              onChange={(value) => onTypographyScale("interface", value)}
            />
          </section>

          <section className="typography-card">
            <h2>Conversation</h2>
            <FontSetting
              label="Body font"
              description="User messages, assistant prose, and the composer."
              value={primaryFont}
              onChange={(value) => onTypography(interfaceFont, value, secondaryFont, codeFont)}
            />
            <FontSetting
              label="Heading font"
              description="Headings inside assistant responses."
              value={secondaryFont}
              onChange={(value) => onTypography(interfaceFont, primaryFont, value, codeFont)}
            />
            <ScaleSetting
              value={conversationFontScale}
              onChange={(value) => onTypographyScale("conversation", value)}
            />
          </section>

          <section className="typography-card">
            <h2>Code</h2>
            <FontSetting
              label="Font"
              description="Code blocks, diffs, tool data, and the Git editor."
              value={codeFont}
              onChange={(value) => onTypography(interfaceFont, primaryFont, secondaryFont, value)}
            />
            <NumberSetting
              label="Code-block size"
              description="Text size in conversation code blocks, from 10 to 24 pixels."
              value={codeBlockFontSize}
              min={10}
              max={24}
              onChange={onCodeBlockFontSize}
            />
            <NumberSetting
              label="Editor size"
              description="Text size in the Git editor, from 10 to 24 pixels."
              value={editorFontSize}
              min={10}
              max={24}
              onChange={onEditorFontSize}
            />
          </section>
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function ContextSettings({
  mode,
  threshold,
  error,
  onChange,
}: {
  mode: CompactionMode;
  threshold: number;
  error: string | null;
  onChange: (mode: CompactionMode, threshold: number) => void;
}): JSX.Element {
  return (
    <section className="settings view-enter" aria-label="Context settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Context</h1>
        <p className="settings-description">Prepare a compact history in the background before long context becomes unreliable.</p>

        <label className="setting-field">
          <span>
            <strong>Compaction</strong>
            <small>Automatic adjusts the threshold to the selected model's context window.</small>
          </span>
          <select value={mode} onChange={(event) => onChange(event.target.value as CompactionMode, threshold)}>
            <option value="automatic">Automatic</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        {mode === "custom" ? (
          <NumberSetting
            label="Compact at"
            description="Prepare a summary when the projected context reaches this percentage."
            value={threshold}
            min={30}
            max={90}
            onChange={(value) => onChange(mode, value)}
          />
        ) : (
          <p className="settings-note">Automatic defaults: 80% up to 128k, 65% up to 400k, and 55% above 400k.</p>
        )}

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function WebSettings({
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
            <strong>Web search</strong>
            <small>Expose web_search to the model. The selected connection decides cost and output style.</small>
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

        <p className="editor-current">
          <span>Connection status</span>
          <strong>{backend === "openrouter"
            ? openRouterAvailable ? "Ready · uses the existing OpenRouter key" : "OpenRouter key is unavailable"
            : ketchAvailable ? info.needsKey && !configured ? "API key required" : "Ready · powered by Ketch"
            : "Ketch is unavailable in this build"}</strong>
        </p>

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
        <div className="editor-actions">
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

function FontSetting({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: FontId;
  onChange: (value: FontId) => void;
}): JSX.Element {
  return (
    <label className="setting-field font-setting">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value as FontId)}>
        {FONT_OPTIONS.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
      </select>
    </label>
  );
}

function ScaleSetting({ value, onChange }: { value: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <div className="setting-field scale-setting">
      <span>
        <strong>Text size</strong>
        <small>Adjust this group while keeping its size hierarchy.</small>
      </span>
      <div className="scale-control" aria-label="Text size">
        <button
          type="button"
          aria-label="Decrease text size"
          disabled={value <= FONT_SCALE_MIN}
          onClick={() => onChange(value - FONT_SCALE_STEP)}
        >−</button>
        <output>{value}%</output>
        <button
          type="button"
          aria-label="Increase text size"
          disabled={value >= FONT_SCALE_MAX}
          onClick={() => onChange(value + FONT_SCALE_STEP)}
        >+</button>
      </div>
    </div>
  );
}

function EditorSettings({
  command,
  argumentsTemplate,
  error,
  onChange,
  onChoose,
}: {
  command: string;
  argumentsTemplate: string;
  error: string | null;
  onChange: (command: string, argumentsTemplate: string) => void;
  onChoose: () => void;
}): JSX.Element {
  const [commandInput, setCommandInput] = useState(command);
  const [argumentsInput, setArgumentsInput] = useState(argumentsTemplate);
  useEffect(() => setCommandInput(command), [command]);
  useEffect(() => setArgumentsInput(argumentsTemplate), [argumentsTemplate]);

  function save(): void {
    onChange(commandInput.trim(), argumentsInput.trim());
  }

  return (
    <section className="settings view-enter" aria-label="Editor settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Editor</h1>
        <p className="settings-description">Choose which application opens files from the Git panel.</p>

        <div className="editor-current">
          <span>Current editor</span>
          <strong title={command || "System default"}>{command || "System default"}</strong>
        </div>
        <div className="editor-actions">
          <button className="primary" type="button" onClick={onChoose}>Choose application…</button>
          <button type="button" disabled={!command} onClick={() => onChange("", "")}>Use system default</button>
        </div>

        <label className="setting-field text-setting">
          <span>
            <strong>Command (advanced)</strong>
            <small>Optionally enter an executable path or CLI command manually.</small>
          </span>
          <input
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setCommandInput(command);
            }}
            placeholder="code-insiders"
          />
        </label>
        <label className="setting-field text-setting">
          <span>
            <strong>Arguments (advanced)</strong>
            <small>Leave blank to pass the file. Use {"{path}"} for the file or {"{folder}"} for its folder.</small>
          </span>
          <input
            value={argumentsInput}
            onChange={(event) => setArgumentsInput(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setArgumentsInput(argumentsTemplate);
            }}
            placeholder="--goto {path}"
          />
        </label>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function AgentSettings({
  maxSteps,
  providerTimeoutMinutes,
  providerRetries,
  error,
  onMaxSteps,
  onProviderTimeoutMinutes,
  onProviderRetries,
}: {
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
  error: string | null;
  onMaxSteps: (maxSteps: number) => void;
  onProviderTimeoutMinutes: (minutes: number) => void;
  onProviderRetries: (retries: number) => void;
}): JSX.Element {
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
          description="Additional attempts after a provider request or stream fails."
          value={providerRetries}
          min={0}
          max={10}
          onChange={onProviderRetries}
        />

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}

function NumberSetting({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}): JSX.Element {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);

  function save(): void {
    const next = Number(input);
    if (!Number.isInteger(next) || next < min || next > max) {
      setInput(String(value));
      return;
    }
    onChange(next);
  }

  return (
    <label className="setting-field">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setInput(String(value));
        }}
      />
    </label>
  );
}
