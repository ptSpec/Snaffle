import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
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
  const latestTurn = turns.at(-1);
  const [selectedTurnId, setSelectedTurnId] = useState(() => latestTurn?.id ?? "");
  const [selectedFilePath, setSelectedFilePath] = useState(() => latestTurn?.files[0]?.path ?? "");
  const turnElements = useRef(new Map<string, HTMLElement>());
  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? latestTurn;
  const selectedFile = selectedTurn?.files.find((file) => file.path === selectedFilePath)
    ?? selectedTurn?.files[0];

  useEffect(() => {
    const requestedTurn = request ? turns.find((turn) => turn.id === request.turnId) : undefined;
    if (!requestedTurn) return;
    setSelectedTurnId(requestedTurn.id);
    setSelectedFilePath(requestedTurn.files[0]?.path ?? "");
    const frame = window.requestAnimationFrame(() => {
      turnElements.current.get(requestedTurn.id)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [request, turns]);

  if (!turns.length) {
    return <p className="inspector-empty">No file changes recorded from built-in tools.</p>;
  }

  return (
    <div className="agent-changes-view">
      <div className="agent-change-turns">
        {turns.map((turn, index) => {
          const selected = turn.id === selectedTurn?.id;
          return (
            <button
              className={`agent-change-turn${selected ? " selected" : ""}`}
              key={turn.id}
              type="button"
              ref={(element) => {
                if (element) turnElements.current.set(turn.id, element);
                else turnElements.current.delete(turn.id);
              }}
              onClick={() => {
                setSelectedTurnId(turn.id);
                setSelectedFilePath(turn.files[0]?.path ?? "");
              }}
            >
              <span className="agent-change-turn-copy">
                <strong>{turn.title}</strong>
                <small>Turn {index + 1} · {turn.label}</small>
              </span>
              <ChangeCounts added={turn.added} removed={turn.removed} />
            </button>
          );
        })}
      </div>
      {selectedTurn ? (
        <div className="agent-change-files">
          <span>Files · {selectedTurn.files.length}</span>
          <div
            className="agent-change-file-tabs"
            role="tablist"
            aria-label="Changed files"
            onWheel={scrollFilesHorizontally}
          >
            {selectedTurn.files.map((file) => (
              <button
                className={file.path === selectedFile?.path ? "selected" : ""}
                type="button"
                role="tab"
                aria-selected={file.path === selectedFile?.path}
                key={file.path}
                title={file.path}
                onClick={() => setSelectedFilePath(file.path)}
              >
                <strong>{file.path}</strong>
                <ChangeCounts added={file.added} removed={file.removed} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {selectedTurn && selectedFile ? (
        <section className="agent-change-detail">
          <header>
            <strong title={selectedFile.path}>{selectedFile.path}</strong>
            <ChangeCounts added={selectedFile.added} removed={selectedFile.removed} />
          </header>
          <FileDiff turn={selectedTurn} file={selectedFile} />
        </section>
      ) : null}
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

function scrollFilesHorizontally(event: WheelEvent<HTMLDivElement>): void {
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const strip = event.currentTarget;
  const next = Math.max(0, Math.min(
    strip.scrollWidth - strip.clientWidth,
    strip.scrollLeft + event.deltaY,
  ));
  if (next === strip.scrollLeft) return;
  event.preventDefault();
  strip.scrollLeft = next;
}
