import { useEffect, useState, type CSSProperties } from "react";
import type { TimelineItem } from "./timeline-state.js";
import "./execution-tool-preview.css";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

const COMMAND_LINES = 16;
const SEARCH_RESULTS = 12;
const READ_LINES = 18;

export function isExecutionPreviewTool(name: string): boolean {
  return name === "run_command" || name === "search_files" || name === "read_file";
}

export function ExecutionToolPreview({
  item,
  selected,
  turnRunning,
  autoExpanded,
  statusClass,
  duration,
  onSelect,
}: {
  item: ToolItem;
  selected: boolean;
  turnRunning: boolean;
  autoExpanded: boolean;
  statusClass: string;
  duration?: string | undefined;
  onSelect(): void;
}): JSX.Element | null {
  const preview = previewFor(item);
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
    const visibleAt = item.completedAt ?? item.startedAt ?? Date.now();
    const remaining = Math.max(0, visibleAt + 1_500 - Date.now());
    const timeout = window.setTimeout(() => setOpen(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [autoExpanded, item.completedAt, item.startedAt, turnRunning]);

  if (!preview) return null;

  const animateResult = item.completedAt !== undefined && Date.now() - item.completedAt < 2_000;
  return (
    <div className={open ? "execution-tool-entry open" : "execution-tool-entry"}>
      <button
        className={`tool-row execution-tool-row ${statusClass}${selected ? " selected" : ""}`}
        type="button"
        aria-expanded={open}
        title="Inspect tool call and toggle result"
        onClick={() => {
          onSelect();
          if (!autoExpanded) setOpen((current) => !current);
        }}
      >
        <PreviewIcon kind={preview.kind} />
        <span className="tool-row-copy">
          <span className="tool-row-title">
            <strong>{preview.title}</strong>
            {item.call.inputRepair ? <span className="tool-healed" title={item.call.inputRepair}>healed</span> : null}
          </span>
          <span className="tool-row-status" title={preview.subtitle}>{preview.subtitle}</span>
        </span>
        {duration ? <time>{duration}</time> : null}
        <span className={open ? "file-tool-chevron open" : "file-tool-chevron"} aria-hidden="true" />
      </button>
      <div className={`execution-tool-reveal${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="execution-tool-reveal-content">
          <div className={`execution-tool-preview ${preview.kind}${animateResult ? " animate-result" : ""}`}>
            {preview.kind === "command" ? <CommandPreview preview={preview} running={item.phase === "running"} /> : null}
            {preview.kind === "search" ? <SearchPreview preview={preview} running={item.phase === "running"} /> : null}
            {preview.kind === "read" ? <ReadPreview preview={preview} running={item.phase === "running"} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type CommandData = {
  kind: "command";
  title: string;
  subtitle: string;
  command: string;
  lines: string[];
  hiddenLines: number;
  result: string;
};
type SearchData = {
  kind: "search";
  title: string;
  subtitle: string;
  query: string;
  scope: string;
  results: string[];
  hiddenResults: number;
};
type ReadData = {
  kind: "read";
  title: string;
  subtitle: string;
  path: string;
  offset: number;
  lines: string[];
  hiddenLines: number;
};
type PreviewData = CommandData | SearchData | ReadData;

function CommandPreview({ preview, running }: { preview: CommandData; running: boolean }): JSX.Element {
  return (
    <>
      <div className="execution-command-line"><span aria-hidden="true">$</span><code>{preview.command}</code>{running ? <i aria-hidden="true" /> : null}</div>
      {running ? <RunningIndicator label="Running command" /> : (
        <>
          {preview.lines.length ? <ResultLines lines={preview.lines} /> : <p className="execution-tool-empty">No command output.</p>}
          <footer><span>{preview.result}</span>{preview.hiddenLines ? <small>{preview.hiddenLines} earlier lines hidden</small> : null}</footer>
        </>
      )}
    </>
  );
}

function SearchPreview({ preview, running }: { preview: SearchData; running: boolean }): JSX.Element {
  return (
    <>
      <div className={running ? "execution-search-query running" : "execution-search-query"}>
        <SearchIcon />
        <code>{preview.query}</code>
        <small>{preview.scope}</small>
      </div>
      {running ? <RunningIndicator label="Searching workspace" /> : preview.results.length ? (
        <div className="execution-search-results">
          {preview.results.map((result, index) => <SearchResult key={`${index}:${result}`} result={result} index={index} />)}
          {preview.hiddenResults ? <small>… {preview.hiddenResults} more matches</small> : null}
        </div>
      ) : <p className="execution-tool-empty">No matches.</p>}
    </>
  );
}

function ReadPreview({ preview, running }: { preview: ReadData; running: boolean }): JSX.Element {
  return (
    <>
      <header className="execution-read-heading"><FileIcon /><strong>{preview.path}</strong><small>from line {preview.offset}</small></header>
      {running ? (
        <div className="execution-read-loading" aria-label="Reading file">
          {Array.from({ length: 6 }, (_, index) => <span key={index} style={{ width: `${76 - (index % 3) * 13}%` }} />)}
        </div>
      ) : (
        <div className="execution-read-result">
          <pre><code>{preview.lines.map((line, index) => (
            <span className="execution-read-line" key={`${index}:${line}`} style={{ "--tool-result-delay": `${Math.floor(index / 3) * 90}ms` } as CSSProperties}>
              <span>{preview.offset + index}</span><span>{line || " "}</span>
            </span>
          ))}</code></pre>
          {preview.hiddenLines ? <small>… {preview.hiddenLines} more lines</small> : null}
        </div>
      )}
    </>
  );
}

function ResultLines({ lines }: { lines: string[] }): JSX.Element {
  return (
    <pre className="execution-command-output"><code>{lines.map((line, index) => (
      <span key={`${index}:${line}`} style={{ "--tool-result-delay": `${Math.min(index, 10) * 65}ms` } as CSSProperties}>{line || " "}</span>
    ))}</code></pre>
  );
}

function SearchResult({ result, index }: { result: string; index: number }): JSX.Element {
  const match = /^(.+?):(\d+):(.*)$/.exec(result);
  return (
    <div className="execution-search-result" style={{ "--tool-result-delay": `${Math.min(index, 10) * 70}ms` } as CSSProperties}>
      {match ? <><strong>{match[1]}:{match[2]}</strong><span>{match[3]}</span></> : <span>{result}</span>}
    </div>
  );
}

function RunningIndicator({ label }: { label: string }): JSX.Element {
  return <div className="execution-tool-running"><span aria-hidden="true" /><small>{label}</small></div>;
}

function previewFor(item: ToolItem): PreviewData | null {
  const input = recordValue(item.call.input);
  if (!input) return null;
  if (item.call.name === "run_command") return commandData(item, input);
  if (item.call.name === "search_files") return searchData(item, input);
  if (item.call.name === "read_file") return readData(item, input);
  return null;
}

function commandData(item: ToolItem, input: Record<string, unknown>): CommandData | null {
  const command = stringValue(input.command);
  if (!command) return null;
  const allLines = textLines(item.content ?? "");
  let result = item.isError ? "Failed" : item.phase === "running" ? "Running" : `Exit ${item.exitCode ?? "unknown"}`;
  while (allLines[0]?.startsWith("permission:")) allLines.shift();
  if (/^(exit code|status):/.test(allLines[0] ?? "")) result = allLines.shift()!.replace(/^exit code:/, "Exit");
  const lines = allLines.slice(-COMMAND_LINES);
  return {
    kind: "command",
    title: item.isError ? "Command failed" : item.phase === "running" ? "Running command" : "Command completed",
    subtitle: command,
    command,
    lines,
    hiddenLines: Math.max(0, allLines.length - lines.length),
    result,
  };
}

function searchData(item: ToolItem, input: Record<string, unknown>): SearchData | null {
  const query = stringValue(input.query);
  if (!query) return null;
  const scope = stringValue(input.path) ?? "workspace";
  const allResults = item.content === "No matches." || !item.content
    ? []
    : textLines(item.content).filter((line) => line && !line.startsWith("[More than "));
  const results = allResults.slice(0, SEARCH_RESULTS);
  return {
    kind: "search",
    title: item.isError
      ? "Search failed"
      : item.phase === "running"
        ? "Searching files"
        : allResults.length ? `Found ${allResults.length} match${allResults.length === 1 ? "" : "es"}` : "No matches",
    subtitle: `“${query}” · ${scope}`,
    query,
    scope,
    results,
    hiddenResults: Math.max(0, allResults.length - results.length),
  };
}

function readData(item: ToolItem, input: Record<string, unknown>): ReadData | null {
  const path = stringValue(input.path);
  if (!path) return null;
  const offset = numberValue(input.offset) ?? 1;
  const content = (item.content ?? "").split("\n\n[Showing lines ")[0] ?? "";
  const allLines = item.phase === "completed" && item.content !== undefined ? textLines(content) : [];
  const lines = allLines.slice(0, READ_LINES);
  return {
    kind: "read",
    title: item.isError
      ? "Read failed"
      : item.phase === "running"
        ? "Reading file"
        : `Read ${allLines.length} line${allLines.length === 1 ? "" : "s"}`,
    subtitle: path,
    path,
    offset,
    lines,
    hiddenLines: Math.max(0, allLines.length - lines.length),
  };
}

function PreviewIcon({ kind }: { kind: PreviewData["kind"] }): JSX.Element {
  if (kind === "command") {
    return <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="2" /><path d="m4 6 2 2-2 2M8 10h3" /></svg>;
  }
  if (kind === "search") return <SearchIcon className="tool-row-icon" />;
  return <FileIcon className="tool-row-icon" />;
}

function SearchIcon({ className }: { className?: string }): JSX.Element {
  return <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;
}

function FileIcon({ className }: { className?: string }): JSX.Element {
  return <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" /></svg>;
}

function textLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").split("\n");
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
