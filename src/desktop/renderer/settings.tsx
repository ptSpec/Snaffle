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
}): JSX.Element {
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
