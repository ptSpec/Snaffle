import { useEffect, useState } from "react";
import { THEMES } from "../themes/index.js";
import type { SettingsPage } from "./sidebar.js";

export function Settings({
  page,
  themeId,
  maxSteps,
  providerTimeoutMinutes,
  providerRetries,
  error,
  onSelectTheme,
  onMaxSteps,
  onProviderTimeoutMinutes,
  onProviderRetries,
}: {
  page: SettingsPage;
  themeId: string;
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
  error: string | null;
  onSelectTheme: (themeId: string) => void;
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
                <span style={{ background: theme.colors["sidebar-background"] }} />
                <span style={{ background: theme.colors["app-background"] }} />
                <span style={{ background: theme.colors["inspector-background"] }} />
              </span>
              <span>{theme.name}</span>
              <span className="theme-check" aria-hidden="true">
                {theme.id === themeId ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>

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
