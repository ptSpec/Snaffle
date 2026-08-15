import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContextReport } from "../../../../context/report.js";

const CONTEXT_GAUGE_REVEAL_COMPACTION_PROGRESS = 0.3;

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
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<{ right: number; bottom: number } | null>(null);
  const tokens = (report?.estimatedTokens ?? 0) + extraTokens;
  const limit = report?.contextLength ?? 1;
  const progress = report ? Math.min(tokens / limit, 1) : 0;
  const compactAt = report?.compactAtTokens ?? limit;
  const state = !report ? "normal" : tokens >= limit ? "danger" : tokens >= compactAt ? "warning" : "normal";
  const activity = compacting ? "Compacting" : report?.preparing ? "Preparing context" : "Context";
  const revealed = Boolean(report && tokens >= compactAt * CONTEXT_GAUGE_REVEAL_COMPACTION_PROGRESS);

  useEffect(() => {
    function close(event: PointerEvent): void {
      if (details.current?.open && event.target instanceof Node &&
        !details.current.contains(event.target) && !popup.current?.contains(event.target)) {
        details.current.open = false;
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPopupPosition(null);
      return;
    }
    const updatePosition = (): void => {
      const rect = details.current?.getBoundingClientRect();
      if (!rect) return;
      setPopupPosition({
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 6,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <>
      <details
        ref={details}
        className={`context-gauge ${state}${revealed ? " revealed" : ""}${compacting || report?.preparing ? " busy" : ""}`}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          aria-label={`${activity} details`}
          title={report ? `Context · ${formatTokens(tokens)} of ${formatTokens(limit)} tokens` : "Context · calculating"}
          tabIndex={revealed ? 0 : -1}
        >
          <span className="context-gauge-meter" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        </summary>
      </details>
      {open && popupPosition ? createPortal(
        <div
          ref={popup}
          className="context-gauge-details"
          style={{ right: popupPosition.right, bottom: popupPosition.bottom }}
        >
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
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  const value = tokens / 1_000;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}k`;
}
