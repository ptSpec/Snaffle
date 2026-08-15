import hljs from "highlight.js/lib/common";
import { useState } from "react";

export function JsonInspector({ value }: { value: unknown }): JSX.Element {
  const [raw, setRaw] = useState(true);
  const [copied, setCopied] = useState(false);
  if (!isJsonContainer(value)) return <pre>{formatJson(value)}</pre>;
  const entries = Object.entries(value);

  async function copyJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatJson(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="json-inspector">
      <div className="json-inspector-mode">
        <div className="json-inspector-tabs">
          <button className={!raw ? "active" : ""} type="button" onClick={() => setRaw(false)}>
            Parsed
          </button>
          <button className={raw ? "active" : ""} type="button" onClick={() => setRaw(true)}>
            Raw
          </button>
        </div>
        <button type="button" onClick={() => void copyJson()} title="Copy JSON">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {raw ? (
        <HighlightedJson value={value} />
      ) : entries.length ? (
        entries.map(([name, field]) => <JsonField key={name} name={name} value={field} />)
      ) : (
        <code className="json-empty">{Array.isArray(value) ? "[]" : "{}"}</code>
      )}
    </div>
  );
}

export function CopyableOutput({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`copyable-output${className ? ` ${className}` : ""}`}>
      <button type="button" onClick={() => void copyOutput()} title="Copy output">
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function HighlightedJson({ value }: { value: unknown }): JSX.Element {
  const formatted = formatJson(value);

  try {
    const highlighted = hljs.highlight(formatted, {
      language: "json",
      ignoreIllegals: true,
    }).value;

    return (
      <pre className="json-raw">
        <code
          className="hljs language-json"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    );
  } catch {
    return <pre className="json-raw">{formatted}</pre>;
  }
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
