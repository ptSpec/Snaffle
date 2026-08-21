import { useEffect, useState, type CSSProperties } from "react";
import type { TimelineItem } from "./timeline-state.js";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
export type FileChangeLine = { kind: "added" | "removed" | "hunk"; text: string };
type PreviewLine = FileChangeLine;
type Preview = { path: string; detail: string; operation: "edited" | "wrote"; lines: PreviewLine[] };

export type FileChangeSummary = {
  label: string;
  added: number;
  removed: number;
  files: { path: string; added: number; removed: number }[];
};

export type FileChangeTurn = {
  id: string;
  title: string;
  label: string;
  added: number;
  removed: number;
  files: {
    path: string;
    added: number;
    removed: number;
    lines: FileChangeLine[];
    hiddenLines: number;
  }[];
};

const MAX_PREVIEW_LINES = 80;
const MAX_TURN_FILE_LINES = 400;

export function isFileMutationTool(name: string): boolean {
  return name === "edit_file" || name === "write_file";
}

export function FileChangeSummaryCard({
  summary,
  onOpenFile,
  onReview,
}: {
  summary: FileChangeSummary;
  onOpenFile?: (path: string) => void;
  onReview?: () => void;
}): JSX.Element {
  return (
    <section className="file-change-summary" aria-label={summary.label}>
      <header>
        <span className="file-change-summary-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <rect x="3" y="3" width="14" height="14" rx="3" />
            <path d="M7 10h6M10 7v6M6 16v1h8v-1" />
          </svg>
        </span>
        <span className="file-change-summary-copy">
          <strong>{summary.label}</strong>
          <span><b>+{summary.added}</b> <i>−{summary.removed}</i></span>
        </span>
        {onReview ? <button type="button" onClick={onReview}>Review</button> : null}
      </header>
      <ul>
        {summary.files.map((file) => (
          <li key={file.path}>
            {onOpenFile ? (
              <button type="button" onClick={() => onOpenFile(file.path)} title={`Open ${file.path}`}>
                {file.path}
              </button>
            ) : <span title={file.path}>{file.path}</span>}
            <span className="file-change-counts"><b>+{file.added}</b> <i>−{file.removed}</i></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FileToolPreview({
  item,
  selected,
  turnRunning,
  autoExpanded,
  statusClass,
  duration,
  onSelect,
  onOpenFile,
}: {
  item: ToolItem;
  selected: boolean;
  turnRunning: boolean;
  autoExpanded: boolean;
  statusClass: string;
  duration?: string | undefined;
  onSelect(): void;
  onOpenFile?: (path: string) => void;
}): JSX.Element | null {
  const preview = previewFor(item);
  const recentlyStarted = item.startedAt !== undefined && Date.now() - item.startedAt < 2_000;
  const minimumVisibleMs = preview
    ? Math.min(
        3_200,
        Math.max(1_200, Math.max(0, ...animationDelays(preview.lines.slice(0, MAX_PREVIEW_LINES))) + 320),
      )
    : 1_200;
  const [open, setOpen] = useState(autoExpanded);

  useEffect(() => {
    if (autoExpanded) {
      setOpen(true);
      return;
    }
    if (!turnRunning) {
      setOpen(false);
      return;
    }

    const remaining = Math.max(0, (item.startedAt ?? Date.now()) + minimumVisibleMs - Date.now());
    const timeout = window.setTimeout(() => setOpen(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [autoExpanded, item.startedAt, minimumVisibleMs, turnRunning]);

  if (!preview) return null;

  const lines = preview.lines.slice(0, MAX_PREVIEW_LINES);
  const delays = animationDelays(lines);
  const hiddenLines = preview.lines.length - lines.length;
  const animate = recentlyStarted && !item.isError;
  const state = item.isError
    ? "Failed"
    : item.phase === "running"
      ? item.call.name === "edit_file" ? "Editing" : "Writing"
      : item.call.name === "edit_file" ? "Edited" : "Wrote";

  return (
    <div className={open ? "file-tool-entry open" : "file-tool-entry"}>
      <button
        className={`tool-row file-tool-row ${statusClass}${selected ? " selected" : ""}`}
        type="button"
        aria-expanded={open}
        title="Inspect tool call and toggle changes"
        onClick={() => {
          onSelect();
          if (!autoExpanded) setOpen((current) => !current);
        }}
      >
        <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" />
        </svg>
        <span className="tool-row-copy">
          <span className="tool-row-title">
            <strong>{state} · {preview.detail}</strong>
            {item.call.inputRepair ? (
              <span className="tool-healed" title={item.call.inputRepair}>healed</span>
            ) : null}
          </span>
          <span className="tool-row-status" title={preview.path}>{preview.path}</span>
        </span>
        {duration ? <time>{duration}</time> : null}
        <span className={open ? "file-tool-chevron open" : "file-tool-chevron"} aria-hidden="true" />
      </button>
      <div className={`file-tool-preview-reveal${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="file-tool-preview-reveal-content">
          <div className={`file-tool-preview${animate ? " animating" : ""}`}>
            <pre>
              <code>
                {lines.map((line, index) => (
                  <span
                    className={`file-tool-preview-line ${line.kind}`}
                    key={`${index}:${line.kind}:${line.text}`}
                    style={{ "--file-tool-delay": `${delays[index]}ms` } as CSSProperties}
                  >
                    <span className="file-tool-preview-prefix" aria-hidden="true">
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : "·"}
                    </span>
                    <span className="file-tool-preview-text">{line.text || " "}</span>
                  </span>
                ))}
              </code>
            </pre>
            {hiddenLines ? (
              <small className="file-tool-preview-truncated">… {hiddenLines} more lines</small>
            ) : null}
            {onOpenFile ? (
              <button
                className="file-tool-open"
                type="button"
                onClick={() => onOpenFile(preview.path)}
                aria-label={`Expand ${preview.path} in the code editor`}
              >
                <span>Expand</span>
                <span aria-hidden="true">›</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function animationDelays(lines: PreviewLine[]): number[] {
  const removedCount = lines.filter((line) => line.kind === "removed").length;
  const additionsStart = removedCount
    ? 180 + Math.min(removedCount - 1, 16) * 70 + 260 + 140
    : 140;
  let removedIndex = 0;
  let addedIndex = 0;

  return lines.map((line) => {
    if (line.kind === "removed") return 180 + Math.min(removedIndex++, 16) * 70;
    if (line.kind === "added") return additionsStart + Math.min(addedIndex++, 20) * 115;
    return 0;
  });
}

function previewFor(item: ToolItem): Preview | null {
  const input = recordValue(item.call.input);
  const path = stringValue(input?.path);
  if (!input || !path) return null;

  if (item.call.name === "write_file") {
    const content = stringValue(input.content, true);
    if (content === undefined) return null;
    const lines = textLines(content).map((text) => ({ kind: "added" as const, text }));
    return {
      path,
      detail: `${lines.length} line${lines.length === 1 ? "" : "s"}`,
      operation: "wrote",
      lines,
    };
  }

  if (item.call.name !== "edit_file" || !Array.isArray(input.edits)) return null;
  const lines: PreviewLine[] = [];
  let editCount = 0;
  for (const rawEdit of input.edits) {
    const edit = recordValue(rawEdit);
    const oldText = stringValue(edit?.oldText, true);
    const newText = stringValue(edit?.newText, true);
    if (oldText === undefined || newText === undefined) continue;
    editCount += 1;
    if (input.edits.length > 1) lines.push({ kind: "hunk", text: `Edit ${editCount}` });
    if (oldText) lines.push(...textLines(oldText).map((text) => ({ kind: "removed" as const, text })));
    if (newText) lines.push(...textLines(newText).map((text) => ({ kind: "added" as const, text })));
  }
  if (!editCount) return null;
  return {
    path,
    detail: `${editCount} replacement${editCount === 1 ? "" : "s"}`,
    operation: "edited",
    lines,
  };
}

export function fileChangeSummaries(items: TimelineItem[]): Map<string, FileChangeSummary> {
  const summaries = new Map<string, FileChangeSummary>();
  let mutations: { path: string; operation: Preview["operation"]; added: number; removed: number }[] = [];

  function visit(item: TimelineItem): void {
    if (item.kind === "user") {
      mutations = [];
      return;
    }
    if (item.kind === "activity-group") {
      for (const child of item.items) visit(child);
      return;
    }
    if (item.kind === "tool" && !item.isError) {
      const mutation = mutationStatsFor(item);
      if (mutation) mutations.push(mutation);
      return;
    }
    if (item.kind !== "assistant" || item.streaming || item.intermediate || !mutations.length) return;

    const files = new Map<string, { path: string; added: number; removed: number }>();
    for (const mutation of mutations) {
      const file = files.get(mutation.path) ?? { path: mutation.path, added: 0, removed: 0 };
      file.added += mutation.added;
      file.removed += mutation.removed;
      files.set(mutation.path, file);
    }
    const operations = new Set(mutations.map((mutation) => mutation.operation));
    const verb = operations.size > 1 ? "Changed" : operations.has("wrote") ? "Wrote" : "Edited";
    const fileList = [...files.values()];
    summaries.set(item.id, {
      label: `${verb} ${fileCount(fileList.length)}`,
      added: fileList.reduce((total, file) => total + file.added, 0),
      removed: fileList.reduce((total, file) => total + file.removed, 0),
      files: fileList,
    });
    mutations = [];
  }

  for (const item of items) visit(item);
  return summaries;
}

export function fileChangeTurns(items: TimelineItem[]): FileChangeTurn[] {
  const turns: FileChangeTurn[] = [];
  let mutations: Preview[] = [];
  let title = "Untitled turn";

  function visit(item: TimelineItem): void {
    if (item.kind === "user") {
      mutations = [];
      title = turnTitle(item.text);
      return;
    }
    if (item.kind === "activity-group") {
      for (const child of item.items) visit(child);
      return;
    }
    if (item.kind === "tool" && !item.isError) {
      const mutation = previewFor(item);
      if (mutation) mutations.push(mutation);
      return;
    }
    if (item.kind !== "assistant" || item.streaming || item.intermediate || !mutations.length) return;

    const files = new Map<string, FileChangeTurn["files"][number]>();
    for (const mutation of mutations) {
      const existing = files.get(mutation.path);
      const file = existing ?? { path: mutation.path, added: 0, removed: 0, lines: [], hiddenLines: 0 };
      const added = mutation.lines.filter((line) => line.kind === "added").length;
      const removed = mutation.lines.filter((line) => line.kind === "removed").length;
      file.added += added;
      file.removed += removed;
      if (existing?.lines.length && file.lines.length < MAX_TURN_FILE_LINES) {
        file.lines.push({ kind: "hunk", text: "Later change" });
      }
      const remaining = Math.max(0, MAX_TURN_FILE_LINES - file.lines.length);
      file.lines.push(...mutation.lines.slice(0, remaining));
      file.hiddenLines += Math.max(0, mutation.lines.length - remaining);
      files.set(mutation.path, file);
    }
    const fileList = [...files.values()];
    const operations = new Set(mutations.map((mutation) => mutation.operation));
    const verb = operations.size > 1 ? "Changed" : operations.has("wrote") ? "Wrote" : "Edited";
    turns.push({
      id: item.id,
      title,
      label: `${verb} ${fileCount(fileList.length)}`,
      added: fileList.reduce((total, file) => total + file.added, 0),
      removed: fileList.reduce((total, file) => total + file.removed, 0),
      files: fileList,
    });
    mutations = [];
  }

  for (const item of items) visit(item);
  return turns;
}

export function latestToolPreviewId(items: TimelineItem[]): string | null {
  let latest: string | null = null;
  let turnFinished = false;

  function visit(item: TimelineItem): void {
    if (item.kind === "activity-group") {
      for (const child of item.items) visit(child);
    } else if (item.kind === "tool") {
      latest = isToolPreviewName(item.call.name) ? item.id : null;
    } else if (item.kind === "assistant" && !item.streaming && !item.intermediate) {
      turnFinished = true;
    }
  }

  let start = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "user") {
      start = index + 1;
      break;
    }
  }
  for (const item of items.slice(start)) visit(item);
  return turnFinished ? null : latest;
}

function isToolPreviewName(name: string): boolean {
  return isFileMutationTool(name) || name === "run_command" || name === "search_files" || name === "read_file";
}

function textLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").split("\n");
}

function mutationStatsFor(item: ToolItem): {
  path: string;
  operation: Preview["operation"];
  added: number;
  removed: number;
} | null {
  const input = recordValue(item.call.input);
  const path = stringValue(input?.path);
  if (!input || !path) return null;

  if (item.call.name === "write_file") {
    const content = stringValue(input.content, true);
    return content === undefined
      ? null
      : { path, operation: "wrote", added: lineCount(content), removed: 0 };
  }
  if (item.call.name !== "edit_file" || !Array.isArray(input.edits)) return null;

  let added = 0;
  let removed = 0;
  let editCount = 0;
  for (const rawEdit of input.edits) {
    const edit = recordValue(rawEdit);
    const oldText = stringValue(edit?.oldText, true);
    const newText = stringValue(edit?.newText, true);
    if (oldText === undefined || newText === undefined) continue;
    editCount += 1;
    if (oldText) removed += lineCount(oldText);
    if (newText) added += lineCount(newText);
  }
  return editCount ? { path, operation: "edited", added, removed } : null;
}

function lineCount(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function fileCount(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function turnTitle(text: string): string {
  const title = text.trim().replaceAll(/\s+/g, " ");
  if (!title) return "Untitled turn";
  return title.length > 84 ? `${title.slice(0, 81)}…` : title;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown, allowEmpty = false): string | undefined {
  return typeof value === "string" && (allowEmpty || value) ? value : undefined;
}
