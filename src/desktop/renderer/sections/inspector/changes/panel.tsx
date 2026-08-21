import { useEffect, useMemo, useRef, useState } from "react";
import {
  fileChangeTurns,
  type FileChangeLine,
  type FileChangeTurn,
} from "../../conversation/file-tool-preview.js";
import type { TimelineItem } from "../../conversation/timeline-state.js";
import "./panel.css";

export default function ChangesPanel({
  timeline,
  request,
}: {
  timeline: TimelineItem[];
  request: { turnId: string; requestId: number } | null;
}): JSX.Element {
  const turns = useMemo(() => fileChangeTurns(timeline), [timeline]);
  const [openTurns, setOpenTurns] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const turnElements = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!request || !turns.some((turn) => turn.id === request.turnId)) return;
    setOpenTurns((current) => withValue(current, request.turnId, true));
    const frame = window.requestAnimationFrame(() => {
      turnElements.current.get(request.turnId)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [request, turns]);

  if (!turns.length) {
    return <p className="inspector-empty">No file changes recorded from built-in tools.</p>;
  }

  return (
    <div className="agent-changes-view">
      <div className="agent-change-turns">
        {turns.map((turn) => {
          const turnOpen = openTurns.has(turn.id);
          const allFilesOpen = turn.files.every((file) => openFiles.has(fileKey(turn.id, file.path)));
          return (
            <details
              className="agent-change-turn"
              key={turn.id}
              open={turnOpen}
              ref={(element) => {
                if (element) turnElements.current.set(turn.id, element);
                else turnElements.current.delete(turn.id);
              }}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpenTurns((current) => withValue(current, turn.id, open));
              }}
            >
              <summary>
                <span className="agent-change-chevron" aria-hidden="true" />
                <span className="agent-change-turn-copy">
                  <strong>{turn.title}</strong>
                  <small>{turn.label}</small>
                </span>
                <ChangeCounts added={turn.added} removed={turn.removed} />
              </summary>
              <div className="agent-change-turn-body">
                <div className="agent-change-turn-actions">
                  <span>{turn.files.length} file{turn.files.length === 1 ? "" : "s"}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenFiles((current) => {
                        const next = new Set(current);
                        for (const file of turn.files) {
                          const key = fileKey(turn.id, file.path);
                          if (allFilesOpen) next.delete(key);
                          else next.add(key);
                        }
                        return next;
                      });
                    }}
                  >
                    {allFilesOpen ? "Collapse all" : "Expand all"}
                  </button>
                </div>
                {turn.files.map((file) => {
                  const key = fileKey(turn.id, file.path);
                  return (
                    <details
                      className="agent-change-file"
                      key={file.path}
                      open={openFiles.has(key)}
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setOpenFiles((current) => withValue(current, key, open));
                      }}
                    >
                      <summary>
                        <span className="agent-change-chevron" aria-hidden="true" />
                        <strong title={file.path}>{file.path}</strong>
                        <ChangeCounts added={file.added} removed={file.removed} />
                      </summary>
                      <FileDiff turn={turn} file={file} />
                    </details>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function FileDiff({
  turn,
  file,
}: {
  turn: FileChangeTurn;
  file: FileChangeTurn["files"][number];
}): JSX.Element {
  return (
    <div className="agent-change-diff">
      <pre><code>{file.lines.map((line, index) => <DiffLine key={`${turn.id}:${file.path}:${index}`} line={line} />)}</code></pre>
      {file.hiddenLines ? <small>… {file.hiddenLines} more lines</small> : null}
    </div>
  );
}

function DiffLine({ line }: { line: FileChangeLine }): JSX.Element {
  return (
    <span className={`agent-change-line ${line.kind}`}>
      <span aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : "·"}</span>
      <span>{line.text || " "}</span>
    </span>
  );
}

function ChangeCounts({ added, removed }: { added: number; removed: number }): JSX.Element {
  return <span className="agent-change-counts"><b>+{added}</b><i>−{removed}</i></span>;
}

function fileKey(turnId: string, path: string): string {
  return `${turnId}\u0000${path}`;
}

function withValue(current: Set<string>, value: string, included: boolean): Set<string> {
  if (current.has(value) === included) return current;
  const next = new Set(current);
  if (included) next.add(value);
  else next.delete(value);
  return next;
}
