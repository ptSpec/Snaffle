import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopWorkspace, GitChanges, GitFileChange, GitFileContents } from "../../../api.js";

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspace) return;
    setLoading(true);
    setFailure(null);
    try {
      const next = await window.desktop.getGitChanges(workspace.id);
      setChanges(next);
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

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? changes?.files.filter((file) => file.path.toLowerCase().includes(query)) ?? [] : changes?.files ?? [];
  }, [changes, filter]);
  const selectedFile = changes?.files.find((file) => file.path === selectedPath);

  async function initialize(): Promise<void> {
    if (!workspace || running) return;
    setLoading(true);
    setFailure(null);
    try {
      setChanges(await window.desktop.initializeGitRepository(workspace.id));
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
            <FileName path={selectedFile.path} />
            <span className="change-counts"><b>+{selectedFile.additions}</b> <i>−{selectedFile.deletions}</i></span>
            <div className="change-actions">
              <button type="button" disabled={!fileContents || draft === fileContents.current || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
              <button type="button" disabled={!selectedFile.exists} onClick={() => void fileAction("open")}>Open</button>
              <button type="button" disabled={!selectedFile.exists} onClick={() => void fileAction("reveal")}>Reveal</button>
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
            <input className="change-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter files" aria-label="Filter changed files" />
          ) : null}
          <div className="change-files">
            {changes.files.length === 0 ? <p className="inspector-empty">No working-tree changes.</p> : null}
            {visibleFiles.map((file) => <FileChange key={file.path} file={file} onSelect={() => setSelectedPath(file.path)} />)}
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

function FileChange({ file, onSelect }: { file: GitFileChange; onSelect(): void }): JSX.Element {
  return (
    <button className="change-file" type="button" onClick={onSelect} title={file.path}>
      <span className={`change-status status-${file.status === "?" ? "new" : file.status.toLowerCase()}`}>{file.status}</span>
      <FileName path={file.path} />
      <small><b>+{file.additions}</b> <i>−{file.deletions}</i></small>
    </button>
  );
}

function FileName({ path }: { path: string }): JSX.Element {
  const slash = path.lastIndexOf("/");
  return <span className="change-file-name" title={path}>{slash >= 0 ? <span>{path.slice(0, slash + 1)}</span> : null}<strong>{path.slice(slash + 1)}</strong></span>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
