import { useState } from "react";

export function JsonInspector({ value }: { value: unknown }): JSX.Element {
  const [raw, setRaw] = useState(false);
  if (!isJsonContainer(value)) return <pre>{formatJson(value)}</pre>;
  const entries = Object.entries(value);

  return (
    <div className="json-inspector">
      <div className="json-inspector-mode">
        <button className={!raw ? "active" : ""} type="button" onClick={() => setRaw(false)}>
          Parsed
        </button>
        <button className={raw ? "active" : ""} type="button" onClick={() => setRaw(true)}>
          Raw
        </button>
      </div>
      {raw ? (
        <pre>{formatJson(value)}</pre>
      ) : entries.length ? (
        entries.map(([name, field]) => <JsonField key={name} name={name} value={field} />)
      ) : (
        <code className="json-empty">{Array.isArray(value) ? "[]" : "{}"}</code>
      )}
    </div>
  );
}

function JsonField({ name, value }: { name: string; value: unknown }): JSX.Element {
  const [open, setOpen] = useState(false);
  const expandable = isJsonContainer(value) || (typeof value === "string" && (value.length > 100 || value.includes("\n")));

  if (!expandable) {
    return (
      <div className="json-field inline">
        <strong>{name}</strong>
        <code>{formatJson(value)}</code>
      </div>
    );
  }

  return (
    <div className="json-field">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={open ? "json-caret open" : "json-caret"} aria-hidden="true">›</span>
        <strong>{name}</strong>
        <small>{summary(value)}</small>
      </button>
      {open ? <pre>{formatJson(value)}</pre> : null}
    </div>
  );
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return (
    Array.isArray(value) ||
    Boolean(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
  );
}

function summary(value: unknown): string {
  if (typeof value === "string") return `String · ${value.length.toLocaleString()} characters`;
  if (Array.isArray(value)) return `Array · ${value.length} items`;
  return `Object · ${Object.keys(value as object).length} fields`;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
