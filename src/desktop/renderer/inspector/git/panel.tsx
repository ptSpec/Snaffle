import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopWorkspace, GitChanges, GitFileContents } from "../../../api.js";
import { SearchPicker } from "../../search-picker.js";
import type { GitEditorHandle } from "./editor.js";
import { FileChange } from "./file-change.js";

const GitEditor = lazy(() => import("./editor.js"));

export function GitPanel({
  workspace,
  running,
  onEditorOpen,
}: {
  workspace: DesktopWorkspace | null;
  running: boolean;
  onEditorOpen(open: boolean): void;
}): JSX.Element {
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<GitFileContents | null>(null);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [commitPaths, setCommitPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [pathCopied, setPathCopied] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const editor = useRef<GitEditorHandle>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspace) return;
    setLoading(true);
    setFailure(null);
    try {
      const next = await window.desktop.getGitChanges(workspace.id);
      setChanges(next);
      setPreviewVersion((current) => current + 1);
      setSelectedPath((current) => next.files.some((file) => file.path === current) ? current : null);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    setChanges(null);
    setSelectedPath(null);
    setFileContents(null);
    setDirty(false);
    setFilter("");
    setCommitMessage("");
    setCommitDescription("");
    setCommitPaths(new Set());
  }, [workspace?.id]);

  useEffect(() => {
    if (workspace && !running) void refresh();
  }, [refresh, running, workspace]);

  useEffect(() => {
    if (!workspace || !selectedPath) {
      setFileContents(null);
      setDirty(false);
      return;
    }
    let current = true;
    setFailure(null);
    setFileContents(null);
    void window.desktop.getGitFile(workspace.id, selectedPath).then(
      (next) => {
        if (!current) return;
        setFileContents(next);
        setDirty(false);
      },
      (error) => { if (current) setFailure(errorMessage(error)); },
    );
    return () => { current = false; };
  }, [changes, selectedPath, workspace]);

  useEffect(() => {
    setPathCopied(false);
  }, [selectedPath]);

  useEffect(() => {
    onEditorOpen(Boolean(selectedPath));
  }, [onEditorOpen, selectedPath]);

  useEffect(() => () => onEditorOpen(false), [onEditorOpen]);

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? changes?.files.filter((file) => file.path.toLowerCase().includes(query)) ?? [] : changes?.files ?? [];
  }, [changes, filter]);
  const selectedFile = changes?.files.find((file) => file.path === selectedPath);
  const selectedCommitPaths = changes?.files.filter((file) => commitPaths.has(file.path)).map((file) => file.path) ?? [];
  const allFilesSelected = changes?.files.length === selectedCommitPaths.length && selectedCommitPaths.length > 0;

  async function initialize(): Promise<void> {
    if (!workspace || running) return;
    setLoading(true);
    setFailure(null);
    try {
      setChanges(await window.desktop.initializeGitRepository(workspace.id));
      setPreviewVersion((current) => current + 1);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function fileAction(action: "open" | "reveal", filePath = selectedFile?.path): Promise<void> {
    if (!workspace || !filePath) return;
    setFailure(null);
    try {
      if (action === "open") await window.desktop.openWorkspaceFile(workspace.id, filePath);
      else await window.desktop.revealWorkspaceFile(workspace.id, filePath);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  async function save(content?: string): Promise<void> {
    if (!workspace || !selectedPath || !fileContents || (!dirty && content === undefined) || saving) return;
    const nextContent = content ?? editor.current?.value();
    if (nextContent === undefined) return;
    setSaving(true);
    setFailure(null);
    try {
      await window.desktop.saveGitFile(workspace.id, selectedPath, nextContent, fileContents.lineEnding);
      await refresh();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function copyPath(filePath = selectedPath, relative = false): Promise<void> {
    if (!workspace || !filePath) return;
    try {
      await navigator.clipboard.writeText(relative ? filePath : absoluteWorkspacePath(workspace.path, filePath));
      if (filePath === selectedPath) {
        setPathCopied(true);
        window.setTimeout(() => setPathCopied(false), 1200);
      }
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  async function commit(): Promise<void> {
    if (!workspace || !commitMessage.trim() || selectedCommitPaths.length === 0 || committing || running) return;
    setCommitting(true);
    setFailure(null);
    try {
      const message = [commitMessage.trim(), commitDescription.trim()].filter(Boolean).join("\n\n");
      const next = await window.desktop.commitGitChanges(workspace.id, message, selectedCommitPaths);
      setChanges(next);
      setPreviewVersion((current) => current + 1);
      setSelectedPath((current) => next.files.some((file) => file.path === current) ? current : null);
      setCommitMessage("");
      setCommitDescription("");
      setCommitPaths(new Set());
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setCommitting(false);
    }
  }

  function toggleCommitPath(filePath: string): void {
    setCommitPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  if (!workspace) return <p className="inspector-empty">Open a workspace to use Git.</p>;
  if (!changes && loading) return <p className="inspector-empty">Checking Git…</p>;
  if (changes?.state !== "ready") {
    return (
      <GitState
        state={changes}
        failure={failure}
        loading={loading}
        onInitialize={() => void initialize()}
        onRefresh={() => void refresh()}
      />
    );
  }

  return (
    <div className="changes-view">
      {selectedFile ? (
        <div className="change-detail">
          <div className="change-detail-heading">
            <button className="change-back" type="button" onClick={() => setSelectedPath(null)} aria-label="Back to changed files">‹</button>
            <SearchPicker
              className="change-file-picker"
              value={selectedFile.path}
              options={changes.files.map((file) => ({
                value: file.path,
                label: file.path.slice(file.path.lastIndexOf("/") + 1),
              }))}
              placeholder="Select changed file"
              searchPlaceholder="Search changed files…"
              onChange={setSelectedPath}
            />
            <span className="change-counts"><b>+{selectedFile.additions}</b> <i>−{selectedFile.deletions}</i></span>
            <div className="change-actions">
              <div>
                <button type="button" onClick={() => void copyPath()}>{pathCopied ? "Copied" : "Copy path"}</button>
                <button type="button" disabled={!selectedFile.exists} onClick={() => void fileAction("open")}>Open in editor</button>
                <button type="button" disabled={!selectedFile.exists} onClick={() => void fileAction("reveal")}>{revealLabel()}</button>
              </div>
              <button className="change-save" type="button" disabled={!fileContents || !dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
          {failure ? <p className="change-error">{failure}</p> : null}
          {fileContents ? (
            <Suspense fallback={<p className="inspector-empty">Loading editor…</p>}>
              <GitEditor
                ref={editor}
                path={selectedFile.path}
                current={fileContents.current}
                original={fileContents.original}
                onDirty={() => setDirty(true)}
                onSave={(content) => void save(content)}
              />
            </Suspense>
          ) : failure ? null : <p className="inspector-empty">Loading file…</p>}
        </div>
      ) : (
        <>
          <div className="changes-summary">
            <span className="change-branch" title={changes.branch ?? "Detached HEAD"}>
              <BranchIcon />
              <strong>{changes.branch ?? "Detached HEAD"}</strong>
            </span>
            <span className="change-counts"><b>+{changes.additions}</b> <i>−{changes.deletions}</i></span>
            <button type="button" onClick={() => void refresh()} disabled={loading} title="Refresh changes">↻</button>
          </div>
          {changes.files.length ? (
            <details className="commit-panel">
              <summary className="commit-summary">
                <span>Commit changes</span>
                <small>{selectedCommitPaths.length} selected</small>
              </summary>
              <div className="commit-body">
                <div className="commit-entry">
                  <input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    maxLength={72}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commit();
                    }}
                    placeholder="Commit message"
                    aria-label="Commit message"
                  />
                  {commitMessage.length >= 70 ? <small className="commit-limit">{commitMessage.length}/72</small> : null}
                </div>
                <textarea
                  value={commitDescription}
                  onChange={(event) => setCommitDescription(event.target.value)}
                  maxLength={5000}
                  rows={3}
                  placeholder="Description (optional)"
                  aria-label="Commit description"
                />
                <div className="commit-footer">
                  {running ? <small className="commit-hint">Wait for the active run to finish before committing.</small> : null}
                  <button
                    className="primary"
                    type="button"
                    disabled={!commitMessage.trim() || selectedCommitPaths.length === 0 || committing || running}
                    onClick={() => void commit()}
                  >
                    {committing ? "Committing…" : "Commit"}
                  </button>
                </div>
              </div>
            </details>
          ) : null}
          {failure ? <p className="change-error">{failure}</p> : null}
          {changes.files.length ? (
            <label className="change-filter">
              <SearchIcon />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter files" aria-label="Filter changed files" />
            </label>
          ) : null}
          <div className="change-files">
            {changes.files.length === 0 ? <p className="inspector-empty">No working-tree changes.</p> : null}
            {changes.files.length ? (
              <label className="change-select-all">
                <input
                  className="selection-checkbox"
                  type="checkbox"
                  checked={allFilesSelected}
                  onChange={() => setCommitPaths(allFilesSelected ? new Set() : new Set(changes.files.map((file) => file.path)))}
                />
                <span>{allFilesSelected ? "Clear selection" : "Select all"}</span>
                <small>{changes.files.length} files</small>
              </label>
            ) : null}
            {visibleFiles.map((file) => (
              <FileChange
                key={file.path}
                workspaceId={workspace.id}
                file={file}
                selected={commitPaths.has(file.path)}
                previewVersion={previewVersion}
                onToggle={() => toggleCommitPath(file.path)}
                onSelect={() => setSelectedPath(file.path)}
                onAction={(action) => {
                  if (action === "copy") void copyPath(file.path);
                  else if (action === "copy-relative") void copyPath(file.path, true);
                  else void fileAction(action, file.path);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function revealLabel(): string {
  if (window.desktop.platform === "darwin") return "Reveal in Finder";
  if (window.desktop.platform === "win32") return "Reveal in Explorer";
  return "Reveal in file manager";
}

function absoluteWorkspacePath(workspacePath: string, filePath: string): string {
  const separator = window.desktop.platform === "win32" ? "\\" : "/";
  return `${workspacePath.replace(/[\\/]+$/, "")}${separator}${filePath.replaceAll("/", separator)}`;
}

function GitState({
  state,
  failure,
  loading,
  onInitialize,
  onRefresh,
}: {
  state: GitChanges | null;
  failure: string | null;
  loading: boolean;
  onInitialize(): void;
  onRefresh(): void;
}): JSX.Element | null {
  const message = failure ?? state?.message;
  if (!message) return null;
  return (
    <div className="git-state">
      <p>{message}</p>
      {state?.state === "not-repository" ? <button className="primary" type="button" onClick={onInitialize} disabled={loading}>Initialize repository</button> : null}
      {state?.state === "unavailable" ? <button type="button" onClick={() => void window.desktop.openExternal("https://git-scm.com/downloads")}>Install Git</button> : null}
      <button type="button" onClick={onRefresh} disabled={loading}>Retry</button>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3 3" />
    </svg>
  );
}

function BranchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
      <path d="M4 4.5v7M5.5 10C9 10 12 8.5 12 6.5" />
    </svg>
  );
}
