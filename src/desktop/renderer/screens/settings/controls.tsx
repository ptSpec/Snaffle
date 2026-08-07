import { useEffect, useState } from "react";
import {
  FONT_OPTIONS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  type FontId,
} from "../../../typography.js";

export function FontSetting({
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

export function ScaleSetting({ value, onChange }: { value: number; onChange: (value: number) => void }): JSX.Element {
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


export function NumberSetting({
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
