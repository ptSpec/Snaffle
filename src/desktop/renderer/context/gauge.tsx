import { useEffect, useRef } from "react";
import type { ContextReport } from "../../../context/report.js";

export function ContextGauge({
  report,
  extraTokens,
  compacting,
  onCompact,
}: {
  report: ContextReport | null;
  extraTokens: number;
  compacting: boolean;
  onCompact(): void;
}): JSX.Element {
  const details = useRef<HTMLDetailsElement>(null);
  const tokens = (report?.estimatedTokens ?? 0) + extraTokens;
  const limit = report?.contextLength ?? 1;
  const progress = Math.min(tokens / limit, 1);
  const compactAt = report?.compactAtTokens ?? limit;
  const state = tokens >= limit ? "danger" : tokens >= compactAt ? "warning" : "normal";

  useEffect(() => {
    function close(event: PointerEvent): void {
      if (details.current?.open && event.target instanceof Node && !details.current.contains(event.target)) {
        details.current.open = false;
      }
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <>
      <svg className={`context-rail ${state}`} aria-hidden="true">
        <rect className="context-rail-base" x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="13" pathLength="1" />
        <rect
          className="context-rail-fill"
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="13"
          pathLength="1"
          style={{ strokeDasharray: `${progress} 1` }}
        />
      </svg>
      <details ref={details} className="context-gauge">
        <summary aria-label="Context details" title="Context details">
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" />
            <path d="M9 2.5a6.5 6.5 0 0 1 6.5 6.5" />
          </svg>
        </summary>
        <div className="context-gauge-details">
          <strong>Context</strong>
          {report ? (
            <>
              <p>{formatTokens(tokens)} of {formatTokens(limit)} estimated</p>
              <small>
                Prepares near {formatTokens(report.prepareAtTokens)} · applies near {formatTokens(compactAt)}
              </small>
              <small>{report.preparing || compacting
                ? "Preparing a checkpoint…"
                : report.checkpointPrepared
                  ? "A checkpoint is ready"
                  : "No checkpoint prepared"}</small>
              <button
                type="button"
                disabled={!report.canCompact || report.preparing || compacting}
                onClick={onCompact}
              >
                {report.preparing || compacting ? "Compacting…" : "Compact now"}
              </button>
              {!report.canCompact ? <small>Nothing older to compact yet</small> : null}
            </>
          ) : <p>Calculating…</p>}
        </div>
      </details>
    </>
  );
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  const value = tokens / 1_000;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}k`;
}
