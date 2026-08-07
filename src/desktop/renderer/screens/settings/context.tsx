import type { CompactionMode } from "../../../../context/budget.js";
import { NumberSetting } from "./controls.js";

export function ContextSettings({
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


