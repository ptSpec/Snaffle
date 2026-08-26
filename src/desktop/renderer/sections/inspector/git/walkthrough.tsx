import { useEffect, useState } from "react";
import type {
  GitWalkthroughChange,
  GitWalkthroughOptions,
  GitWalkthroughResult,
  GitWalkthroughRunInput,
  GitWalkthroughTarget,
} from "../../../../api.js";
import { FileSyntax } from "../../../components/file-syntax.js";
import { SearchPicker } from "../../../components/search-picker.js";
import { MarkdownContent } from "../../conversation/markdown.js";
import "./walkthrough.css";

export function WalkthroughCard({
  workspaceId,
  hasWorkingChanges,
  running,
  latest,
  providerConnectionId,
  model,
  reasoningEffort,
  onOpenLatest,
  onComplete,
}: {
  workspaceId: string;
  hasWorkingChanges: boolean;
  running: boolean;
  latest: GitWalkthroughResult | null;
  providerConnectionId: string;
  model: string;
  reasoningEffort: GitWalkthroughRunInput["reasoningEffort"];
  onOpenLatest(): void;
  onComplete(result: GitWalkthroughResult): void;
}): JSX.Element {
  const [options, setOptions] = useState<GitWalkthroughOptions | null>(null);
  const [targetKind, setTargetKind] = useState<GitWalkthroughTarget["kind"]>("working");
  const [baseBranch, setBaseBranch] = useState("");
  const [walking, setWalking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setOptions(null);
    setTargetKind("working");
    setBaseBranch("");
    setFailure(null);
    void window.desktop.getGitWalkthroughOptions(workspaceId).then(
      (next) => { if (current) setOptions(next); },
      (error) => { if (current) setFailure(errorMessage(error)); },
    );
    return () => { current = false; };
  }, [workspaceId]);

  const branches = options?.branches.filter((branch) => branch !== options.currentBranch) ?? [];
  const disabled = walking || running || !model || !providerConnectionId || (
    targetKind === "working" ? !hasWorkingChanges : !baseBranch
  );

  async function run(): Promise<void> {
    if (disabled) return;
    const target: GitWalkthroughTarget = targetKind === "working"
      ? { kind: "working" }
      : { kind: "branch", baseBranch };
    setWalking(true);
    setFailure(null);
    try {
      onComplete(await window.desktop.runGitWalkthrough({
        workspaceId,
        target,
        providerConnectionId,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }));
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setWalking(false);
    }
  }

  function chooseTarget(kind: GitWalkthroughTarget["kind"]): void {
    setTargetKind(kind);
    setFailure(null);
  }

  return (
    <section className="walkthrough-card" aria-label="Walk with me">
      <header>
        <WalkthroughMark />
        <span>
          <strong>Walk with me</strong>
          <small>Understand related changes as one guided flow.</small>
        </span>
      </header>

      {latest ? (
        <div className="walkthrough-latest">
          <span>
            <strong>{latest.outdated ? "Older walkthrough" : "Latest walkthrough"}</strong>
            <small>{latest.detail} · {formatSavedAt(latest.createdAt)}</small>
          </span>
          <button type="button" onClick={onOpenLatest}>Open</button>
        </div>
      ) : null}

      <div className="walkthrough-targets" role="group" aria-label="Walkthrough source">
        <button
          className={targetKind === "working" ? "active" : ""}
          type="button"
          onClick={() => chooseTarget("working")}
        >Working changes</button>
        <button
          className={targetKind === "branch" ? "active" : ""}
          type="button"
          onClick={() => chooseTarget("branch")}
        >Compare branch</button>
      </div>

      {targetKind === "branch" ? (
        <div className="walkthrough-branch">
          <span>Compare current branch with</span>
          <SearchPicker
            value={baseBranch}
            options={branches.map((branch) => ({ value: branch }))}
            placeholder="Choose a local branch"
            searchPlaceholder="Search local branches…"
            disabled={!options || !branches.length}
            onChange={setBaseBranch}
          />
          {options?.currentBranch ? <small>Current branch: {options.currentBranch}</small> : null}
          {options?.defaultBranch ? <small>Repository default: {options.defaultBranch}</small> : null}
        </div>
      ) : !hasWorkingChanges ? (
        <p className="walkthrough-note">No working-tree changes to walk through.</p>
      ) : null}

      <footer>
        <small>Runs one isolated model request. It does not use or change this conversation.</small>
        <button className="walkthrough-run" type="button" disabled={disabled} onClick={() => void run()}>
          {walking ? "Creating walk…" : "Run walkthrough"}
        </button>
      </footer>
      {running ? <p className="walkthrough-note">Wait for the active model run to finish.</p> : null}
      {failure ? <p className="walkthrough-error">{failure}</p> : null}
    </section>
  );
}

export function WalkthroughCanvas({
  result,
  onBack,
  onOpenFile,
}: {
  result: GitWalkthroughResult;
  onBack(): void;
  onOpenFile(path: string): void;
}): JSX.Element {
  return (
    <section className="walkthrough-canvas" aria-label={`${result.title} walkthrough`}>
      <header className="walkthrough-canvas-heading">
        <button className="walkthrough-back" type="button" onClick={onBack} title="Back to Git changes (Esc)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.75 3.5-4.5 4.5 4.5 4.5" /></svg>
          <span>Back</span>
        </button>
        <div>
          <strong>{result.title}</strong>
          <small>{result.detail}</small>
        </div>
        <small className="walkthrough-model">
          {result.outdated ? "Older snapshot · " : ""}{formatSavedAt(result.createdAt)} · {result.model} · {formatDuration(result.durationMs)}
        </small>
      </header>
      <article className="walkthrough-document">
        {walkthroughParts(result).map((part, index) => part.kind === "text" ? (
          <div className="walkthrough-narrative markdown-content" key={`text-${index}`}>
            <MarkdownContent text={part.text} />
          </div>
        ) : (
          <WalkthroughChangeBlock
            change={part.change}
            startLine={part.startLine}
            endLine={part.endLine}
            onOpen={() => onOpenFile(part.change.path)}
            key={`${part.change.id}-${index}`}
          />
        ))}
      </article>
    </section>
  );
}

type WalkthroughPart =
  | { kind: "text"; text: string }
  | {
      kind: "change";
      change: GitWalkthroughChange;
      startLine: number;
      endLine: number;
    };

function walkthroughParts(result: GitWalkthroughResult): WalkthroughPart[] {
  const changes = new Map(result.changes.map((change) => [change.id, change]));
  const shown = new Set<string>();
  const parts: WalkthroughPart[] = [];
  const markers = result.text.matchAll(/\[\[change:\s*([a-z]\d+)(?::\s*(\d+)\s*-\s*(\d+))?\s*\]\]/gi);
  let cursor = 0;
  let renderedChanges = 0;
  for (const marker of markers) {
    const start = marker.index ?? cursor;
    if (start > cursor) parts.push({ kind: "text", text: result.text.slice(cursor, start) });
    const change = changes.get(marker[1]?.toUpperCase() ?? "");
    if (!change) parts.push({ kind: "text", text: marker[0] });
    else if (!shown.has(change.id) && renderedChanges < 6) {
      const range = keyRange(change, Number(marker[2]), Number(marker[3]));
      parts.push({ kind: "change", change, ...range });
      shown.add(change.id);
      renderedChanges += 1;
    }
    cursor = start + marker[0].length;
  }
  if (cursor < result.text.length) parts.push({ kind: "text", text: result.text.slice(cursor) });
  return parts;
}

function WalkthroughChangeBlock({
  change,
  startLine,
  endLine,
  onOpen,
}: {
  change: GitWalkthroughChange;
  startLine: number;
  endLine: number;
  onOpen(): void;
}): JSX.Element {
  const lines = change.patch.split("\n");
  const excerpt = lines.slice(startLine - 1, endLine);
  return (
    <section className="walkthrough-change" aria-label={`${kindLabel(change.kind)} change in ${change.path}`}>
      <header>
        <span className={`walkthrough-change-kind ${change.kind}`}>{kindLabel(change.kind)}</span>
        <strong title={change.path}>{change.path}</strong>
        <small>Lines {startLine}–{endLine} of {lines.length}{change.truncated ? " · bounded snapshot" : ""}</small>
        <button type="button" onClick={onOpen}>Open full file</button>
      </header>
      <pre className="walkthrough-change-patch"><code>{excerpt.map((line, index) => (
        <span className={walkthroughLineClass(line)} key={`${startLine + index}:${line}`}>
          {line.startsWith("+") && !line.startsWith("+++")
            ? <><b aria-hidden="true">+</b><FileSyntax path={change.path} text={line.slice(1)} /></>
            : line || " "}
        </span>
      ))}</code></pre>
    </section>
  );
}

function keyRange(
  change: GitWalkthroughChange,
  requestedStart: number,
  requestedEnd: number,
): { startLine: number; endLine: number } {
  const lines = change.patch.split("\n");
  const requested = Number.isInteger(requestedStart) && Number.isInteger(requestedEnd) && requestedEnd >= requestedStart;
  const hunk = lines.findIndex((line) => line.startsWith("@@"));
  const startLine = requested
    ? Math.max(1, Math.min(requestedStart, lines.length))
    : Math.max(1, hunk < 0 ? 1 : hunk - 2);
  const requestedLast = requested ? requestedEnd : startLine + 31;
  return {
    startLine,
    endLine: Math.min(lines.length, startLine + 31, Math.max(startLine, requestedLast)),
  };
}

function WalkthroughMark(): JSX.Element {
  return (
    <span className="walkthrough-mark" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none">
        <path d="M5.5 3.5v11M5.5 6.5h4a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3h.5" />
        <circle cx="5.5" cy="3.5" r="1.5" />
        <circle cx="5.5" cy="16.5" r="1.5" />
        <circle cx="16" cy="12.5" r="1.5" />
      </svg>
    </span>
  );
}

function formatDuration(durationMs: number): string {
  return durationMs < 60_000
    ? `${Math.max(1, Math.round(durationMs / 1_000))}s`
    : `${Math.floor(durationMs / 60_000)}m ${Math.round(durationMs % 60_000 / 1_000)}s`;
}

function formatSavedAt(createdAt: number): string {
  return new Date(createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function walkthroughLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (line.startsWith("@@")) return "hunk";
  return "context";
}

function kindLabel(kind: GitWalkthroughChange["kind"]): string {
  if (kind === "committed") return "Committed";
  if (kind === "staged") return "Staged";
  if (kind === "unstaged") return "Unstaged";
  return "Untracked";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
