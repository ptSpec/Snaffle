import { useEffect, useState } from "react";
import { THEMES } from "../themes/index.js";
import type { SettingsPage } from "./sidebar.js";

export function Settings({
  page,
  themeId,
  maxSteps,
  error,
  onSelectTheme,
  onMaxSteps,
}: {
  page: SettingsPage;
  themeId: string;
  maxSteps: number;
  error: string | null;
  onSelectTheme: (themeId: string) => void;
  onMaxSteps: (maxSteps: number) => void;
}): JSX.Element {
  if (page === "agent") {
    return (
      <AgentSettings maxSteps={maxSteps} error={error} onMaxSteps={onMaxSteps} />
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
  error,
  onMaxSteps,
}: {
  maxSteps: number;
  error: string | null;
  onMaxSteps: (maxSteps: number) => void;
}): JSX.Element {
  const [value, setValue] = useState(String(maxSteps));

  useEffect(() => setValue(String(maxSteps)), [maxSteps]);

  function save(): void {
    const next = Number(value);
    if (!Number.isInteger(next) || next < 1 || next > 200) {
      setValue(String(maxSteps));
      return;
    }
    onMaxSteps(next);
  }

  return (
    <section className="settings view-enter" aria-label="Agent settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Agent</h1>
        <p className="settings-description">Control the limits applied to new runs.</p>

        <label className="setting-field">
          <span>
            <strong>Maximum turns</strong>
            <small>Maximum model turns per run, from 1 to 200.</small>
          </span>
          <input
            type="number"
            min="1"
            max="200"
            step="1"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setValue(String(maxSteps));
            }}
          />
        </label>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}
