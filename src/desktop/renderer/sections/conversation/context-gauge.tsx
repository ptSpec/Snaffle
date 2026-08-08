import { useEffect, useRef } from "react";
import type { ContextReport } from "../../../../context/report.js";

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
  const progress = report ? Math.min(tokens / limit, 1) : 0;
  const compactAt = report?.compactAtTokens ?? limit;
  const state = !report ? "normal" : tokens >= limit ? "danger" : tokens >= compactAt ? "warning" : "normal";
  const activity = compacting ? "Compacting" : report?.preparing ? "Preparing context" : "Context";

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
    <details ref={details} className={`context-gauge ${state}${compacting || report?.preparing ? " busy" : ""}`}>
      <summary
        aria-label={`${activity} details`}
        title={report ? `Context · ${formatTokens(tokens)} of ${formatTokens(limit)} tokens` : "Context · calculating"}
      >
        <span className="context-gauge-meter" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </span>
      </summary>
      <div className="context-gauge-details">
        <strong>Context</strong>
        {report ? (
          <>
            <p>{formatTokens(tokens)} of {formatTokens(limit)} tokens</p>
            <div className="context-gauge-progress" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <small>Context compaction ~{formatTokens(report.prepareAtTokens)} tokens</small>
            <small>{report.preparing || compacting
              ? "Preparing a context checkpoint…"
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
  );
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  const value = tokens / 1_000;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}k`;
}
