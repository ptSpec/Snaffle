import { useEffect, useRef, useState } from "react";
import type { GitDiffPreview, GitFileChange } from "../../../api.js";
import "./preview.css";

export function FileChange({
  workspaceId,
  file,
  selected,
  previewVersion,
  onToggle,
  onSelect,
}: {
  workspaceId: string;
  file: GitFileChange;
  selected: boolean;
  previewVersion: number;
  onToggle(): void;
  onSelect(): void;
}): JSX.Element {
  const [preview, setPreview] = useState<GitDiffPreview | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const showing = useRef(false);

  useEffect(() => setPreview(null), [previewVersion]);
  useEffect(() => () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  }, []);

  function show(event: React.PointerEvent<HTMLDivElement>): void {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.min(520, window.innerWidth - 16);
    setPosition({
      top: Math.max(8, Math.min(bounds.top, window.innerHeight - 360)),
      left: Math.max(8, bounds.left - width + 1),
    });
    showTimer.current = window.setTimeout(() => {
      showing.current = true;
      setVisible(true);
      if (!preview) void window.desktop.getGitDiffPreview(workspaceId, file.path).then(
        (next) => { if (showing.current) setPreview(next); },
        () => { if (showing.current) setPreview({ lines: ["Preview unavailable."], truncated: false }); },
      );
    }, 350);
  }

  function hide(): void {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(close, 250);
  }

  function close(): void {
    showing.current = false;
    setVisible(false);
    setPreview(null);
  }

  return (
    <div className="change-file" onPointerEnter={show} onPointerLeave={hide}>
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Include ${file.path} in commit`} />
      <span className={`change-status status-${file.status === "?" ? "new" : file.status.toLowerCase()}`}>{file.status}</span>
      <button className="change-file-open" type="button" onClick={onSelect} title={file.path}><FileName path={file.path} /></button>
      <small><b>+{file.additions}</b> <i>−{file.deletions}</i></small>
      {visible ? (
        <DiffPreview
          path={file.path}
          preview={preview}
          position={position}
          onEnter={() => window.clearTimeout(hideTimer.current)}
          onLeave={hide}
          onOpen={() => {
            close();
            onSelect();
          }}
        />
      ) : null}
    </div>
  );
}

function DiffPreview({
  path,
  preview,
  position,
  onEnter,
  onLeave,
  onOpen,
}: {
  path: string;
  preview: GitDiffPreview | null;
  position: { top: number; left: number };
  onEnter(): void;
  onLeave(): void;
  onOpen(): void;
}): JSX.Element {
  return (
    <aside
      className="git-hover-preview"
      style={position}
      role="tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={() => {
        if (!window.getSelection()?.toString()) onOpen();
      }}
    >
      <strong>{path}</strong>
      {preview ? (
        <pre>
          {preview.lines.map((line, index) => <span className={lineClass(line)} key={`${index}:${line}`}>{line || " "}</span>)}
          {preview.truncated ? <span className="truncated">… preview truncated</span> : null}
        </pre>
      ) : <small>Loading preview…</small>}
    </aside>
  );
}

function FileName({ path }: { path: string }): JSX.Element {
  const slash = path.lastIndexOf("/");
  return <span className="change-file-name" title={path}>{slash >= 0 ? <span>{path.slice(0, slash + 1)}</span> : null}<strong>{path.slice(slash + 1)}</strong></span>;
}

function lineClass(line: string): string {
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  if (line.startsWith("@@")) return "hunk";
  return "context";
}
