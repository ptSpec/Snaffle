import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopWorkspace, GitChanges, GitFileContents } from "../../../api.js";
import { SearchPicker } from "../../search-picker.js";
import { FileChange } from "./file-change.js";

const GitEditor = lazy(() => import("./editor.js"));

export function GitPanel({
  workspace,
  running,
}: {
  workspace: DesktopWorkspace | null;
  running: boolean;
}): JSX.Element {
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<GitFileContents | null>(null);
  const [draft, setDraft] = useState("");
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
    setDraft("");
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
      setDraft("");
      return;
    }
    let current = true;
    setFailure(null);
    setFileContents(null);
    void window.desktop.getGitFile(workspace.id, selectedPath).then(
      (next) => {
        if (!current) return;
        setFileContents(next);
        setDraft(next.current);
      },
      (error) => { if (current) setFailure(errorMessage(error)); },
    );
    return () => { current = false; };
  }, [changes, selectedPath, workspace]);

  useEffect(() => {
    setPathCopied(false);
  }, [selectedPath]);

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? changes?.files.filter((file) => file.path.toLowerCase().includes(query)) ?? [] : changes?.files ?? [];
  }, [changes, filter]);
  const selectedFile = changes?.files.find((file) => file.path === selectedPath);
  const selectedCommitPaths = changes?.files.filter((file) => commitPaths.has(file.path)).map((file) => file.path) ?? [];

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

  async function fileAction(action: "open" | "reveal"): Promise<void> {
    if (!workspace || !selectedFile?.exists) return;
    setFailure(null);
    try {
      if (action === "open") await window.desktop.openWorkspaceFile(workspace.id, selectedFile.path);
      else await window.desktop.revealWorkspaceFile(workspace.id, selectedFile.path);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  async function save(): Promise<void> {
    if (!workspace || !selectedPath || !fileContents || draft === fileContents.current || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await window.desktop.saveGitFile(workspace.id, selectedPath, draft, fileContents.lineEnding);
      await refresh();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function copyPath(): Promise<void> {
    if (!selectedPath) return;
    try {
      await navigator.clipboard.writeText(selectedPath);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1200);
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
              options={changes.files.map((file) => ({ value: file.path }))}
              placeholder="Select changed file"
              searchPlaceholder="Search changed files…"
              onChange={setSelectedPath}
            />
            <span className="change-counts"><b>+{selectedFile.additions}</b> <i>−{selectedFile.deletions}</i></span>
            <div className="change-actions">
              <div>
                <button type="button" onClick={() => void copyPath()}>{pathCopied ? "Copied" : "Copy path"}</button>
                <button type="button" disabled={!selectedFile.exists} onClick={() => void fileAction("open")}>Open</button>
                <button type="button" disabled={!selectedFile.exists} onClick={() => void fileAction("reveal")}>Reveal</button>
              </div>
              <button className="change-save" type="button" disabled={!fileContents || draft === fileContents.current || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
          {failure ? <p className="change-error">{failure}</p> : null}
          {fileContents ? (
            <Suspense fallback={<p className="inspector-empty">Loading editor…</p>}>
              <GitEditor
                path={selectedFile.path}
                current={fileContents.current}
                original={fileContents.original}
                onChange={setDraft}
                onSave={() => void save()}
              />
            </Suspense>
          ) : failure ? null : <p className="inspector-empty">Loading file…</p>}
        </div>
      ) : (
        <>
          <div className="changes-summary">
            <span>Working tree</span>
            <span className="change-counts"><b>+{changes.additions}</b> <i>−{changes.deletions}</i></span>
            <button type="button" onClick={() => void refresh()} disabled={loading} title="Refresh changes">↻</button>
          </div>
          {changes.files.length ? (
            <details className="commit-panel">
              <summary className="commit-summary">
                <span>Commit changes</span>
                <span className="commit-branch"><small>Branch</small><strong>{changes.branch ?? "Unknown"}</strong></span>
                <small>{selectedCommitPaths.length} selected</small>
              </summary>
              <div className="commit-body">
                <div className="commit-selection">
                  <span>Files to commit</span>
                  <button
                    type="button"
                    onClick={() => setCommitPaths(selectedCommitPaths.length ? new Set() : new Set(changes.files.map((file) => file.path)))}
                  >
                    {selectedCommitPaths.length ? "Clear selection" : "Select all changed files"}
                  </button>
                </div>
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
                  <small className="commit-limit">{commitMessage.length}/72</small>
                  <button
                    className="primary"
                    type="button"
                    disabled={!commitMessage.trim() || selectedCommitPaths.length === 0 || committing || running}
                    onClick={() => void commit()}
                  >
                    {committing ? "Committing…" : `Commit ${selectedCommitPaths.length || ""}`.trim()}
                  </button>
                </div>
                <textarea
                  value={commitDescription}
                  onChange={(event) => setCommitDescription(event.target.value)}
                  maxLength={5000}
                  rows={2}
                  placeholder="Description (optional)"
                  aria-label="Commit description"
                />
                {running ? <small className="commit-hint">Wait for the active run to finish before committing.</small> : null}
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
            {visibleFiles.map((file) => (
              <FileChange
                key={file.path}
                workspaceId={workspace.id}
                file={file}
                selected={commitPaths.has(file.path)}
                previewVersion={previewVersion}
                onToggle={() => toggleCommitPath(file.path)}
                onSelect={() => setSelectedPath(file.path)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
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
