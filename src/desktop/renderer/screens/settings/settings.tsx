import { useEffect, useRef } from "react";
import { PROJECT } from "../../../../identity.js";
import { THEMES } from "../../../themes/index.js";
import type { FontId } from "../../../typography.js";
import type { SettingsPage } from "../../sections/sidebar/sidebar.js";
import type { KetchSearchBackend, WebSearchBackend } from "../../../../tools/web/types.js";
import type { CompactionMode } from "../../../../context/budget.js";
import type { ProviderConnection, ProviderConnectionInput, ProviderStatus } from "../../../../providers/provider.js";
import { AgentSettings } from "./agent.js";
import { FontSetting, NumberSetting, ScaleSetting } from "./controls.js";
import { ContextSettings } from "./context.js";
import { EditorSettings } from "./editor.js";
import { ProviderSettings } from "./providers.js";
import { WebSettings } from "./web.js";

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
  providerConnections,
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
  onSaveProvider,
  onRemoveProvider,
  onTestProvider,
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
  providerConnections: ProviderConnection[];
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
  onSaveProvider(input: ProviderConnectionInput): Promise<void>;
  onRemoveProvider(id: string): Promise<void>;
  onTestProvider(id: string): Promise<ProviderStatus>;
}): JSX.Element {
  const themePicker = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeThemePicker(event: PointerEvent): void {
      if (event.target instanceof Node && !themePicker.current?.contains(event.target)) {
        themePicker.current?.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeThemePicker);
    return () => document.removeEventListener("pointerdown", closeThemePicker);
  }, []);

  if (page === "providers") {
    return (
      <ProviderSettings
        connections={providerConnections}
        error={error}
        onSave={onSaveProvider}
        onRemove={onRemoveProvider}
        onTest={onTestProvider}
      />
    );
  }

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

  const selectedTheme = THEMES.find((theme) => theme.id === themeId) ?? THEMES[0]!;

  return (
    <section className="settings view-enter" aria-label="Settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Appearance</h1>
        <p className="settings-description">Choose how {PROJECT.name} looks.</p>

        <details className="theme-picker" ref={themePicker}>
          <summary className="theme-option selected">
            <ThemePreview theme={selectedTheme} />
            <span>{selectedTheme.name}</span>
            <svg className="theme-picker-caret" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </summary>
          <div className="theme-list">
            {THEMES.map((theme) => (
            <button
              className={theme.id === themeId ? "theme-option selected" : "theme-option"}
              type="button"
              key={theme.id}
              onClick={(event) => {
                onSelectTheme(theme.id);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
              aria-pressed={theme.id === themeId}
            >
              <ThemePreview theme={theme} />
              <span>{theme.name}</span>
              <span className="theme-check" aria-hidden="true">
                {theme.id === themeId ? "✓" : ""}
              </span>
            </button>
            ))}
          </div>
        </details>

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

function ThemePreview({ theme }: { theme: (typeof THEMES)[number] }): JSX.Element {
  return (
    <span className="theme-preview" aria-hidden="true">
      <span style={{ background: theme.colors.panel }} />
      <span style={{ background: theme.colors.background }} />
      <span style={{ background: theme.colors.surface }} />
      <span style={{ background: theme.colors.primary }} />
    </span>
  );
}
