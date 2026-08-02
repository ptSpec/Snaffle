import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import logoSvg from "../../../assets/logo_svg.svg?raw";
import { PRODUCT } from "../../identity.js";
import type { DesktopState, DesktopThread } from "../api.js";

export type AppView = "conversation" | "settings";
export type SettingsPage = "appearance" | "agent";

export function Sidebar({
  state,
  runningThreadIds,
  view,
  settingsPage,
  collapsed,
  beforeNavigate,
  onNavigate,
  onUpdate,
  onError,
  onView,
  onSettingsPage,
  onCollapse,
}: {
  state: DesktopState;
  runningThreadIds: string[];
  view: AppView;
  settingsPage: SettingsPage;
  collapsed: boolean;
  beforeNavigate: () => Promise<void>;
  onNavigate: (state: DesktopState) => void;
  onUpdate: (state: DesktopState) => void;
  onError: (message: string | null) => void;
  onView: (view: AppView) => void;
  onSettingsPage: (page: SettingsPage) => void;
  onCollapse: () => void;
}): JSX.Element {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const threadList = useRef<HTMLDivElement>(null);
  const isRunning = (threadId: string): boolean => runningThreadIds.includes(threadId);
  const inactiveWorkspaces = state.workspaces.filter(
    (workspace) => workspace.id !== state.workspace?.id,
  );
  const bookmarks = inactiveWorkspaces.flatMap((workspace) =>
    workspace.threads
      .filter((thread) => thread.bookmarked)
      .map((thread) => ({ thread, workspace })),
  );

  useEffect(() => {
    setSelecting(false);
    setSelectedIds([]);
  }, [state.workspace?.id, state.activeThreadId]);

  useEffect(() => {
    if (!selecting) return;
    const threads = state.workspace?.threads ?? [];
    const activeIndex = threads.findIndex((thread) => thread.id === state.activeThreadId);
    const next = Math.max(0, activeIndex);
    setCursor(next);
    setAnchor(next);
    const frame = window.requestAnimationFrame(() => threadList.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selecting]);

  async function chooseWorkspace(): Promise<void> {
    onError(null);
    try {
      await beforeNavigate();
      const next = await window.desktop.chooseWorkspace();
      if (next) onNavigate(next);
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function newThread(): Promise<void> {
    if (!state.workspace) return;
    try {
      await beforeNavigate();
      onNavigate(await window.desktop.createThread(state.workspace.id));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function selectWorkspace(workspaceId: string): Promise<void> {
    try {
      await beforeNavigate();
      onNavigate(await window.desktop.selectWorkspace(workspaceId));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function selectThread(threadId: string): Promise<void> {
    try {
      await beforeNavigate();
      onNavigate(await window.desktop.selectThread(threadId));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function toggleBookmark(threadId: string, bookmarked: boolean): Promise<void> {
    try {
      onUpdate(await window.desktop.setThreadBookmarked(threadId, bookmarked));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function deleteThreads(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    if (ids.some(isRunning)) {
      onError("A running thread cannot be deleted");
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected thread(s)?`)) return;
    try {
      onNavigate(await window.desktop.deleteThreads(ids));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function deleteThread(thread: DesktopThread): Promise<void> {
    if (isRunning(thread.id) || !window.confirm(`Delete “${thread.title}”?`)) return;
    try {
      onNavigate(await window.desktop.deleteThreads([thread.id]));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function removeWorkspace(workspaceId: string, name: string): Promise<void> {
    if (!window.confirm(`Remove ${name} from Esch? The project directory will not be deleted.`)) {
      return;
    }
    try {
      onNavigate(await window.desktop.removeWorkspace(workspaceId));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  function handleThreadKeys(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!selecting) return;
    const threads = state.workspace?.threads ?? [];
    if (event.key === "Escape") {
      setSelecting(false);
      setSelectedIds([]);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
      event.preventDefault();
      void deleteThreads(selectedIds);
      return;
    }
    if (event.key === " " && event.target === event.currentTarget && threads[cursor]) {
      event.preventDefault();
      const id = threads[cursor].id;
      if (isRunning(id)) return;
      setSelectedIds((ids) =>
        ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
      );
      setAnchor(cursor);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    event.preventDefault();
    const movement = event.key === "ArrowUp" ? -1 : 1;
    const next = Math.max(0, Math.min(threads.length - 1, cursor + movement));
    setCursor(next);
    if (event.shiftKey) {
      const start = Math.min(anchor, next);
      const end = Math.max(anchor, next);
      setSelectedIds(
        threads.slice(start, end + 1).filter((thread) => !isRunning(thread.id)).map((thread) => thread.id),
      );
    } else {
      setAnchor(next);
    }
  }

  return (
    <aside
      className={collapsed ? "left-sidebar collapsed" : "left-sidebar"}
      aria-label={view === "settings" ? "Settings navigation" : "Workspaces and threads"}
      aria-hidden={collapsed}
    >
      <header className="sidebar-brand">
        {view === "settings" ? (
          <span>Settings</span>
        ) : (
          <span className="brand-wordmark" aria-label={PRODUCT.name}>
            <span
              className="brand-mark"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: logoSvg }}
            />
            <span className="brand-name">Sch</span>
          </span>
        )}
        <button
          className="panel-toggle"
          type="button"
          onClick={onCollapse}
          aria-label="Hide workspace sidebar"
          title="Hide sidebar"
        >
          <span className="pane-icon left" aria-hidden="true" />
        </button>
      </header>

      <nav
        className={
          view === "settings"
            ? "sidebar-navigation settings-navigation view-enter"
            : "sidebar-navigation view-enter"
        }
      >
        {view === "settings" ? (
          <>
            <button
              className={settingsPage === "appearance" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("appearance")}
            >
              <span>Appearance</span>
            </button>
            <button
              className={settingsPage === "agent" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("agent")}
            >
              <span>Agent</span>
            </button>
            <div className="settings-navigation-space" aria-hidden="true" />
          </>
        ) : (
          <div key={state.workspace?.id ?? "empty"} className="workspace-navigation workspace-enter">
            <div className="section-heading workspace-heading">
              <h2>Workspace</h2>
              <button
                className="icon-button add-workspace"
                type="button"
                onClick={() => void chooseWorkspace()}
                aria-label="Open workspace"
                title="Open workspace"
              >
                <PlusIcon />
              </button>
            </div>

            {state.workspace ? (
              <>
                <div className="sidebar-row workspace-row active">
                  <div className="workspace-item" title={state.workspace.path}>
                    <WorkspaceIcon />
                    <span>{state.workspace.name}</span>
                  </div>
                  <span className="thread-actions">
                    <button
                      className={
                        selecting ? "row-action thread-action active" : "row-action thread-action"
                      }
                      type="button"
                      onClick={() => {
                        setSelecting((value) => !value);
                        setSelectedIds([]);
                      }}
                      disabled={state.workspace.threads.length === 0}
                      aria-label="Manage threads"
                      aria-pressed={selecting}
                      title="Manage threads"
                    >
                      <PencilIcon />
                    </button>
                  </span>
                  <button
                    className="row-action"
                    type="button"
                    onClick={() => void removeWorkspace(state.workspace!.id, state.workspace!.name)}
                    disabled={state.workspace.threads.some((thread) => isRunning(thread.id))}
                    aria-label={`Remove ${state.workspace.name}`}
                    title="Remove workspace from Esch"
                  >
                    ×
                  </button>
                </div>

                <button
                  className="new-thread-button"
                  type="button"
                  onClick={() => void newThread()}
                >
                  <PlusIcon />
                  <span>New chat thread</span>
                </button>

                <div
                  ref={threadList}
                  className="threads"
                  tabIndex={selecting ? 0 : -1}
                  onKeyDown={handleThreadKeys}
                  aria-label={selecting ? "Manage threads" : undefined}
                >
                  <div className="thread-list">
                    {state.workspace.threads.map((thread, index) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        active={thread.id === state.activeThreadId}
                        selecting={selecting}
                        selected={selectedIds.includes(thread.id)}
                        focused={selecting && index === cursor}
                        running={isRunning(thread.id)}
                        onSelect={() => void selectThread(thread.id)}
                        onToggleSelected={() => {
                          setCursor(index);
                          setAnchor(index);
                          if (isRunning(thread.id)) return;
                          setSelectedIds((ids) =>
                            ids.includes(thread.id)
                              ? ids.filter((id) => id !== thread.id)
                              : [...ids, thread.id],
                          );
                        }}
                        onToggleBookmark={() => void toggleBookmark(thread.id, !thread.bookmarked)}
                        onDelete={() => void deleteThread(thread)}
                      />
                    ))}
                    {selecting ? (
                      <div className="thread-selection-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setSelecting(false);
                            setSelectedIds([]);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={selectedIds.length === 0}
                          onClick={() => void deleteThreads(selectedIds)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {bookmarks.length ? (
                  <div className="bookmarked-threads">
                    <div className="section-heading">
                      <h2>Bookmarked</h2>
                    </div>
                    {bookmarks.map(({ thread, workspace }) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        workspaceName={workspace.name}
                        active={false}
                        selecting={false}
                        selected={false}
                        focused={false}
                        running={isRunning(thread.id)}
                        onSelect={() => void selectThread(thread.id)}
                        onToggleSelected={() => undefined}
                        onToggleBookmark={() => void toggleBookmark(thread.id, false)}
                        onDelete={() => void deleteThread(thread)}
                      />
                    ))}
                  </div>
                ) : null}

                {inactiveWorkspaces.length ? (
                  <div className="inactive-workspaces">
                    <div className="section-heading">
                      <h2>Other workspaces</h2>
                    </div>
                    {inactiveWorkspaces.map((workspace) => (
                      <div className="sidebar-row workspace-row" key={workspace.id}>
                        <button
                          className="workspace-item"
                          type="button"
                          onClick={() => void selectWorkspace(workspace.id)}
                          title={workspace.path}
                        >
                          <WorkspaceIcon />
                          <span>{workspace.name}</span>
                        </button>
                        <button
                          className="row-action"
                          type="button"
                          onClick={() => void removeWorkspace(workspace.id, workspace.name)}
                          disabled={workspace.threads.some((thread) => isRunning(thread.id))}
                          aria-label={`Remove ${workspace.name}`}
                          title="Remove workspace from Esch"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <button className="workspace-item" type="button" onClick={() => void chooseWorkspace()}>
                <span className="workspace-icon" aria-hidden="true">+</span>
                <span>Open workspace</span>
              </button>
            )}
          </div>
        )}
      </nav>

      <footer className="sidebar-footer">
        {view === "settings" ? (
          <button className="sidebar-action" type="button" onClick={() => onView("conversation")}>
            <span aria-hidden="true">←</span>
            <span>Back to chat</span>
          </button>
        ) : (
          <button
            className="sidebar-action"
            type="button"
            onClick={() => {
              onError(null);
              onView("settings");
            }}
          >
            <span aria-hidden="true">⚙</span>
            <span>Settings</span>
          </button>
        )}
      </footer>
    </aside>
  );
}

function ThreadRow({
  thread,
  workspaceName,
  active,
  selecting,
  selected,
  focused,
  running,
  onSelect,
  onToggleSelected,
  onToggleBookmark,
  onDelete,
}: {
  thread: DesktopThread;
  workspaceName?: string;
  active: boolean;
  selecting: boolean;
  selected: boolean;
  focused: boolean;
  running: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
  onToggleBookmark: () => void;
  onDelete: () => void;
}): JSX.Element {
  let className = "sidebar-row thread-row";
  if (active) className += " active";
  if (focused) className += " focused";

  return (
    <div className={className}>
      {selecting ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          disabled={running}
          aria-label={`Select ${thread.title}`}
        />
      ) : null}
      <button
        className="thread-item"
        type="button"
        onClick={selecting ? onToggleSelected : onSelect}
        title={thread.title}
      >
        <span>
          {thread.title}
          {running ? <i className="thread-running" title="Running" aria-label="Running" /> : null}
        </span>
        {workspaceName ? <small>{workspaceName}</small> : null}
      </button>
      {!selecting ? (
        <>
          <button
            className={thread.bookmarked ? "row-action bookmarked" : "row-action"}
            type="button"
            onClick={onToggleBookmark}
            aria-label={thread.bookmarked ? `Unbookmark ${thread.title}` : `Bookmark ${thread.title}`}
            title={thread.bookmarked ? "Remove bookmark" : "Bookmark thread"}
          >
            {thread.bookmarked ? "★" : "☆"}
          </button>
          <button
            className="row-action"
            type="button"
            onClick={onDelete}
            disabled={running}
            aria-label={`Delete ${thread.title}`}
            title="Delete thread"
          >
            <ArchiveIcon />
          </button>
        </>
      ) : null}
    </div>
  );
}

function PlusIcon(): JSX.Element {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
}

function PencilIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3 11.5-.5 2 2-.5 7.8-7.8-1.5-1.5zM9.8 4.7l1.5 1.5" />
    </svg>
  );
}

function ArchiveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 5h11v8.5h-11zM2 2.5h12V5H2zM6 8h4" />
    </svg>
  );
}

function WorkspaceIcon(): JSX.Element {
  return (
    <span className="workspace-icon" aria-hidden="true">
      <svg viewBox="0 0 18 14" fill="none">
        <path d="M1.5 2.5h5l1.6 2h8.4v8H1.5z" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
