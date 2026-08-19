import { useEffect, useRef } from "react";
import { PROJECT } from "../../../../identity.js";
import { THEMES } from "../../../themes/index.js";
import type { FontId } from "../../../typography.js";
import type { SettingsPage } from "../../sections/sidebar/sidebar.js";
import type { KetchSearchBackend, WebSearchBackend } from "../../../../tools/web/types.js";
import type { CompactionMode } from "../../../../context/budget.js";
import type { SubagentProfile } from "../../../../agent/subagents/profile.js";
import type { ImageUnderstandingProfile } from "../../../../attachments/vision.js";
import type { McpServerConfig, McpServerStatus } from "../../../../mcp/types.js";
import type { DesktopUpdateState, ModelToolSetting } from "../../../api.js";
import type {
  ProviderCatalog,
  ProviderConnection,
  ProviderConnectionInput,
  ProviderStatus,
} from "../../../../providers/provider.js";
import { AgentSettings } from "./agent.js";
import { FontSetting, NumberSetting, ScaleSetting } from "./controls.js";
import { ContextSettings } from "./context.js";
import { EditorSettings } from "./editor.js";
import { ProviderSettings } from "./providers.js";
import { WebSettings } from "./web.js";
import { McpSettings } from "./mcp.js";
import { ModelSettings } from "./model.js";
import { UpdateSettings } from "./updates.js";

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
  autoTitleGeneration,
  providerTimeoutMinutes,
  providerRetries,
  subagent,
  imageUnderstanding,
  compactionMode,
  compactionThreshold,
  ketchAvailable,
  openRouterAvailable,
  deepSeekAvailable,
  webSearchEnabled,
  webSearchBackend,
  webSearchKeyBackends,
  providerConnections,
  mcpEnabled,
  mcpServers,
  modelTools,
  systemPrompt,
  runtimeMetadata,
  providerCatalogs,
  loadingProviderModels,
  updateState,
  activeRun,
  error,
  onResetAppearance,
  onSelectTheme,
  onTypography,
  onTypographyScale,
  onCodeBlockFontSize,
  onEditorFontSize,
  onEditorLauncher,
  onChooseEditor,
  onMaxSteps,
  onAutoTitleGeneration,
  onProviderTimeoutMinutes,
  onProviderRetries,
  onSubagent,
  onImageUnderstanding,
  onCompaction,
  onWebSearchEnabled,
  onWebSearchBackend,
  onWebSearchApiKey,
  onSaveProvider,
  onRemoveProvider,
  onTestProvider,
  onMcpEnabled,
  onSaveMcpServer,
  onRemoveMcpServer,
  onTestMcpServer,
  onSystemPrompt,
  onToolEnabled,
  onOpenOnboarding,
  onCheckForUpdates,
  onApplyUpdate,
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
  autoTitleGeneration: boolean;
  providerTimeoutMinutes: number;
  providerRetries: number;
  subagent: SubagentProfile;
  imageUnderstanding: ImageUnderstandingProfile;
  compactionMode: CompactionMode;
  compactionThreshold: number;
  ketchAvailable: boolean;
  openRouterAvailable: boolean;
  deepSeekAvailable: boolean;
  webSearchEnabled: boolean;
  webSearchBackend: WebSearchBackend;
  webSearchKeyBackends: KetchSearchBackend[];
  providerConnections: ProviderConnection[];
  mcpEnabled: boolean;
  mcpServers: McpServerConfig[];
  modelTools: ModelToolSetting[];
  systemPrompt: string;
  runtimeMetadata: string;
  providerCatalogs: ProviderCatalog[];
  loadingProviderModels: boolean;
  updateState: DesktopUpdateState;
  activeRun: boolean;
  error: string | null;
  onResetAppearance: () => void;
  onSelectTheme: (themeId: string) => void;
  onTypography: (interfaceFont: FontId, primary: FontId, secondary: FontId, code: FontId) => void;
  onTypographyScale: (role: "interface" | "conversation", value: number) => void;
  onCodeBlockFontSize: (size: number) => void;
  onEditorFontSize: (size: number) => void;
  onEditorLauncher: (command: string, argumentsTemplate: string) => void;
  onChooseEditor: () => void;
  onMaxSteps: (maxSteps: number) => void;
  onAutoTitleGeneration: (enabled: boolean) => void;
  onProviderTimeoutMinutes: (minutes: number) => void;
  onProviderRetries: (retries: number) => void;
  onSubagent: (profile: SubagentProfile) => void;
  onImageUnderstanding: (profile: ImageUnderstandingProfile) => void;
  onCompaction: (mode: CompactionMode, threshold: number) => void;
  onWebSearchEnabled: (enabled: boolean) => void;
  onWebSearchBackend: (backend: WebSearchBackend) => void;
  onWebSearchApiKey: (backend: KetchSearchBackend, apiKey: string) => void;
  onSaveProvider(input: ProviderConnectionInput): Promise<void>;
  onRemoveProvider(id: string): Promise<void>;
  onTestProvider(input: ProviderConnectionInput): Promise<ProviderStatus>;
  onMcpEnabled(enabled: boolean): void;
  onSaveMcpServer(server: McpServerConfig): Promise<void>;
  onRemoveMcpServer(id: string): Promise<void>;
  onTestMcpServer(server: McpServerConfig): Promise<McpServerStatus>;
  onSystemPrompt(prompt: string): void;
  onToolEnabled(name: string, enabled: boolean): void;
  onOpenOnboarding(): void;
  onCheckForUpdates(): void;
  onApplyUpdate(): void;
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
        catalogs={providerCatalogs}
        loadingCatalogs={loadingProviderModels}
        error={error}
        onSave={onSaveProvider}
        onRemove={onRemoveProvider}
        onTest={onTestProvider}
      />
    );
  }

  if (page === "updates") {
    return (
      <UpdateSettings
        state={updateState}
        activeRun={activeRun}
        onCheck={onCheckForUpdates}
        onApply={onApplyUpdate}
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
        deepSeekAvailable={deepSeekAvailable}
        error={error}
        onEnabled={onWebSearchEnabled}
        onBackend={onWebSearchBackend}
        onSave={onWebSearchApiKey}
      />
    );
  }

  if (page === "mcp") {
    return (
      <McpSettings
        enabled={mcpEnabled}
        servers={mcpServers}
        error={error}
        onEnabled={onMcpEnabled}
        onSave={onSaveMcpServer}
        onRemove={onRemoveMcpServer}
        onTest={onTestMcpServer}
      />
    );
  }

  if (page === "agent") {
    return (
      <AgentSettings
        maxSteps={maxSteps}
        autoTitleGeneration={autoTitleGeneration}
        providerTimeoutMinutes={providerTimeoutMinutes}
        providerRetries={providerRetries}
        subagent={subagent}
        imageUnderstanding={imageUnderstanding}
        providerConnections={providerConnections}
        providerCatalogs={providerCatalogs}
        error={error}
        onMaxSteps={onMaxSteps}
        onAutoTitleGeneration={onAutoTitleGeneration}
        onProviderTimeoutMinutes={onProviderTimeoutMinutes}
        onProviderRetries={onProviderRetries}
        onSubagent={onSubagent}
        onImageUnderstanding={onImageUnderstanding}
      />
    );
  }

  if (page === "model") {
    return (
      <ModelSettings
        systemPrompt={systemPrompt}
        runtimeMetadata={runtimeMetadata}
        tools={modelTools}
        error={error}
        onSystemPrompt={onSystemPrompt}
        onToolEnabled={onToolEnabled}
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
        <div className="appearance-heading">
          <h1>Appearance</h1>
          <button type="button" onClick={onResetAppearance}>Reset to defaults</button>
        </div>
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

        <section className="setup-again">
          <span>
            <strong>Setup guide</strong>
            <small>Review your model, theme, web, and subagent choices without resetting anything.</small>
          </span>
          <button type="button" onClick={onOpenOnboarding}>Run setup again</button>
        </section>

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
