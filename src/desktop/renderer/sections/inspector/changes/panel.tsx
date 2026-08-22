import { useEffect, useMemo, useState } from "react";
import { SearchPicker } from "../../../components/search-picker.js";
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
  onBack,
  onDetailOpen,
}: {
  timeline: TimelineItem[];
  request: { turnId: string; requestId: number } | null;
  onBack(): void;
  onDetailOpen(open: boolean): void;
}): JSX.Element {
  const turns = useMemo(() => fileChangeTurns(timeline), [timeline]);
  const latestTurn = turns.at(-1);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(() => latestTurn?.id ?? null);
  const [selectedFilePath, setSelectedFilePath] = useState(() => latestTurn?.files[0]?.path ?? "");
  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId);
  const selectedFile = selectedTurn?.files.find((file) => file.path === selectedFilePath)
    ?? selectedTurn?.files[0];

  function selectTurn(id: string): void {
    const turn = turns.find((entry) => entry.id === id);
    if (!turn) return;
    setSelectedTurnId(turn.id);
    setSelectedFilePath(turn.files[0]?.path ?? "");
  }

  function backToTurns(): void {
    setSelectedTurnId(null);
    onBack();
  }

  useEffect(() => {
    const requestedTurn = request ? turns.find((turn) => turn.id === request.turnId) : undefined;
    if (!requestedTurn) return;
    selectTurn(requestedTurn.id);
  }, [request, turns]);

  useEffect(() => {
    onDetailOpen(Boolean(selectedTurnId));
  }, [onDetailOpen, selectedTurnId]);

  useEffect(() => {
    if (!selectedTurnId) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      backToTurns();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onBack, selectedTurnId]);

  if (!turns.length) {
    return <p className="inspector-empty">No file changes recorded from built-in tools.</p>;
  }

  return (
    <div className="agent-changes-view">
      {selectedTurn && selectedFile ? (
        <section className="agent-change-detail">
          <div className="change-detail-heading agent-change-detail-heading">
            <div className="change-navigation agent-change-navigation">
              <button className="change-back agent-change-back" type="button" onClick={backToTurns} title="Back to turns (Esc)">
                <svg className="change-back-icon" aria-hidden="true" viewBox="0 0 10 16"><path d="M8 1 1 8l7 7" /></svg>
                <span>Back (Esc)</span>
              </button>
              <SearchPicker
                className="agent-change-picker agent-change-turn-picker"
                value={selectedTurn.id}
                options={turns.map((turn, index) => ({
                  value: turn.id,
                  label: `Turn ${index + 1}`,
                  detail: `${turn.title} · ${turn.label}`,
                }))}
                placeholder="Select turn"
                searchPlaceholder="Search turns…"
                onChange={selectTurn}
              />
              <SearchPicker
                className="agent-change-picker agent-change-file-picker"
                value={selectedFile.path}
                options={selectedTurn.files.map((file) => ({
                  value: file.path,
                  label: compactFileName(file.path),
                  detail: parentPath(file.path),
                }))}
                placeholder="Select changed file"
                searchPlaceholder="Search changed files…"
                onChange={setSelectedFilePath}
              />
            </div>
            <ChangeCounts added={selectedFile.added} removed={selectedFile.removed} />
          </div>
          <FileDiff turn={selectedTurn} file={selectedFile} />
        </section>
      ) : (
        <div className="agent-change-turns">
          {turns.map((turn, index) => (
            <button className="agent-change-turn" key={turn.id} type="button" onClick={() => selectTurn(turn.id)}>
              <span className="agent-change-turn-copy">
                <strong>{turn.title}</strong>
                <small>Turn {index + 1} · {turn.label}</small>
              </span>
              <ChangeCounts added={turn.added} removed={turn.removed} />
            </button>
          ))}
        </div>
      )}
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

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function compactFileName(path: string): string {
  const name = fileName(path);
  return name.length > 40 ? `${name.slice(0, 24)}…${name.slice(-15)}` : name;
}

function parentPath(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? null : path.slice(0, slash);
}
