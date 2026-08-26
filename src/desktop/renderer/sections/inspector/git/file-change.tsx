import { useEffect, useRef, useState } from "react";
import type { GitDiffPreview, GitFileChange } from "../../../../api.js";
import { FileSyntax } from "../../../components/file-syntax.js";
import "./preview.css";

export function FileChange({
  workspaceId,
  file,
  selected,
  previewVersion,
  onToggle,
  onSelect,
  onAction,
}: {
  workspaceId: string;
  file: GitFileChange;
  selected: boolean;
  previewVersion: number;
  onToggle(): void;
  onSelect(): void;
  onAction(action: "open" | "reveal" | "copy" | "copy-relative"): void;
}): JSX.Element {
  const [preview, setPreview] = useState<GitDiffPreview | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const showTimer = useRef<number>();
  const hideTimer = useRef<number>();
  const showing = useRef(false);
  const menuElement = useRef<HTMLDivElement>(null);

  useEffect(() => setPreview(null), [previewVersion]);
  useEffect(() => () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuElement.current?.contains(event.target)) setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  function show(event: React.PointerEvent<HTMLDivElement>): void {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.min(520, window.innerWidth - 16);
    setPosition({
      top: Math.max(8, Math.min(bounds.top, window.innerHeight - 360)),
      left: Math.max(8, bounds.left - width - 2),
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
    <div
      className={`change-file${selected ? " selected" : ""}`}
      onClick={(event) => {
        if (!(event.target as Element).closest("button, input, .git-hover-preview")) onToggle();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        window.clearTimeout(showTimer.current);
        close();
        setMenu({
          top: Math.min(event.clientY, window.innerHeight - 132),
          left: Math.min(event.clientX, window.innerWidth - 210),
        });
      }}
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      <input
        className="selection-checkbox"
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Include ${file.path} in commit`}
      />
      <span className={`change-status status-${file.status === "?" ? "new" : file.status.toLowerCase()}`}>{file.status}</span>
      <FileName path={file.path} />
      <button
        className={`change-file-open-zone${file.editable ? "" : " non-editable"}`}
        type="button"
        onClick={() => { if (file.editable) onSelect(); }}
        title={file.editable ? `Open ${file.path}` : "This path cannot be edited here"}
        aria-label={file.editable ? `Open ${file.path}` : `${file.path} cannot be edited here`}
        aria-disabled={!file.editable}
      >
        <span className="change-file-stats"><b>+{file.additions}</b> <i>−{file.deletions}</i></span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3 5 5-5 5" />
        </svg>
      </button>
      {visible ? (
        <DiffPreview
          path={file.path}
          preview={preview}
          position={position}
          onEnter={() => window.clearTimeout(hideTimer.current)}
          onLeave={hide}
          onOpen={file.editable ? () => {
            close();
            onSelect();
          } : undefined}
        />
      ) : null}
      {menu ? (
        <div
          className="change-file-menu"
          ref={menuElement}
          role="menu"
          style={menu}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" disabled={!file.exists} onClick={() => { setMenu(null); onAction("open"); }}>Open in editor</button>
          <button type="button" role="menuitem" disabled={!file.exists} onClick={() => { setMenu(null); onAction("reveal"); }}>{revealLabel()}</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); onAction("copy"); }}>Copy path</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); onAction("copy-relative"); }}>Copy relative path</button>
        </div>
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
  onOpen: (() => void) | undefined;
}): JSX.Element {
  return (
    <aside
      className="git-hover-preview"
      style={position}
      role="tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={() => {
        if (onOpen && !window.getSelection()?.toString()) onOpen();
      }}
    >
      <strong>{path}</strong>
      {preview ? (
        <pre>
          <code>
            {preview.lines.map((line, index) => (
              <span className={lineClass(line)} key={`${index}:${line}`}>
                {line.startsWith("+") && !line.startsWith("+++")
                  ? <><b aria-hidden="true">+</b><FileSyntax path={path} text={line.slice(1)} /></>
                  : line || " "}
              </span>
            ))}
            {preview.truncated ? <span className="truncated">… preview truncated</span> : null}
          </code>
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
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (line.startsWith("@@")) return "hunk";
  return "context";
}

function revealLabel(): string {
  if (window.desktop.platform === "darwin") return "Reveal in Finder";
  if (window.desktop.platform === "win32") return "Reveal in Explorer";
  return "Reveal in file manager";
}
