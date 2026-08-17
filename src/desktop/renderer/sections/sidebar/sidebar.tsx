import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { PROJECT } from "../../../../identity.js";
import type { DesktopState, DesktopThread, DesktopWorkspace } from "../../../api.js";
import type { BookmarksPage } from "../../screens/bookmarks/bookmarks.js";
import { ThinkingOrb } from "../../components/thinking-orb.js";
import { SidebarContextMenu, type SidebarContextMenuItem } from "./context-menu.js";

export type AppView = "conversation" | "saved" | "search" | "settings";
export type SettingsPage = "appearance" | "providers" | "editor" | "agent" | "model" | "context" | "web" | "mcp";

type SidebarMenu =
  | { kind: "thread"; top: number; left: number; thread: DesktopThread; workspaceId: string }
  | { kind: "workspace"; top: number; left: number; workspace: DesktopWorkspace };

export function Sidebar({
  state,
  runningThreadIds,
  view,
  settingsPage,
  bookmarksPage,
  collapsed,
  beforeNavigate,
  onNavigate,
  onUpdate,
  onError,
  onView,
  onSettingsPage,
  onBookmarksPage,
  onOpenThreadSource,
  terminalOpen,
  onTerminal,
  onCollapse,
}: {
  state: DesktopState;
  runningThreadIds: string[];
  view: AppView;
  settingsPage: SettingsPage;
  bookmarksPage: BookmarksPage;
  collapsed: boolean;
  beforeNavigate: () => Promise<void>;
  onNavigate: (state: DesktopState) => void;
  onUpdate: (state: DesktopState) => void;
  onError: (message: string | null) => void;
  onView: (view: AppView) => void;
  onSettingsPage: (page: SettingsPage) => void;
  onBookmarksPage: (page: BookmarksPage) => void;
  onOpenThreadSource: (thread: DesktopThread) => void;
  terminalOpen: boolean;
  onTerminal: () => void;
  onCollapse: () => void;
}): JSX.Element {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const [promotedThreadId, setPromotedThreadId] = useState(state.activeThreadId);
  const [promotion, setPromotion] = useState<{
    id: string;
    previousId: string | null;
    distance: number;
  } | null>(null);
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const sidebarRoot = useRef<HTMLElement>(null);
  const threadList = useRef<HTMLDivElement>(null);
  const promotedWorkspaceId = useRef(state.workspace?.id);
  const isRunning = (threadId: string): boolean => runningThreadIds.includes(threadId);
  const threads = state.workspace?.threads ?? [];
  const promotedThread = threads.find((thread) => thread.id === promotedThreadId);
  const orderedThreads = promotedThread
    ? [promotedThread, ...threads.filter((thread) => thread.id !== promotedThread.id)]
    : threads;
  const inactiveWorkspaces = state.workspaces.filter(
    (workspace) => workspace.id !== state.workspace?.id,
  );
  useEffect(() => {
    setSelecting(false);
    setSelectedIds([]);
  }, [state.workspace?.id, state.activeThreadId]);

  useEffect(() => {
    const workspaceId = state.workspace?.id;
    const threadId = state.activeThreadId;
    if (promotedWorkspaceId.current !== workspaceId) {
      promotedWorkspaceId.current = workspaceId;
      setPromotedThreadId(threadId);
      setPromotion(null);
      return;
    }
    if (!threadId || threadId === promotedThreadId) return;
    const pendingThreadId = threadId;

    function promote(): void {
      const index = orderedThreads.findIndex((thread) => thread.id === pendingThreadId);
      setPromotion({
        id: pendingThreadId,
        previousId: promotedThreadId,
        distance: Math.min(Math.max(index, 1) * 36, 280),
      });
      setPromotedThreadId(pendingThreadId);
    }

    let promotionTimer: number | undefined;

    function promoteFromOutside(event: Event): void {
      if (sidebarRoot.current?.contains(event.target as Node) || promotionTimer !== undefined) return;
      promotionTimer = window.setTimeout(promote, 650);
    }

    document.addEventListener("pointerdown", promoteFromOutside);
    document.addEventListener("keydown", promoteFromOutside);
    return () => {
      document.removeEventListener("pointerdown", promoteFromOutside);
      document.removeEventListener("keydown", promoteFromOutside);
      if (promotionTimer !== undefined) window.clearTimeout(promotionTimer);
    };
  }, [state.workspace?.id, state.activeThreadId, promotedThreadId]);

  useEffect(() => {
    if (!selecting) return;
    const activeIndex = orderedThreads.findIndex((thread) => thread.id === state.activeThreadId);
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
    await newThreadIn(state.workspace.id);
  }

  async function newThreadIn(workspaceId: string): Promise<void> {
    try {
      await beforeNavigate();
      onNavigate(await window.desktop.createThread(workspaceId));
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
    if (!window.confirm(`Remove ${name} from ${PROJECT.name}? The project directory will not be deleted.`)) {
      return;
    }
    try {
      onNavigate(await window.desktop.removeWorkspace(workspaceId));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function revealWorkspace(workspaceId: string): Promise<void> {
    try {
      await window.desktop.revealWorkspaceFile(workspaceId, ".");
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  function openThreadMenu(event: ReactMouseEvent, thread: DesktopThread): void {
    if (!state.workspace) return;
    event.preventDefault();
    setMenu({ kind: "thread", thread, workspaceId: state.workspace.id, ...menuPosition(event) });
  }

  function openWorkspaceMenu(event: ReactMouseEvent, workspace: DesktopWorkspace): void {
    event.preventDefault();
    setMenu({ kind: "workspace", workspace, ...menuPosition(event) });
  }

  const menuItems: SidebarContextMenuItem[] = menu?.kind === "thread"
    ? [
        { label: "Open thread", action: () => void selectThread(menu.thread.id) },
        {
          label: menu.thread.bookmarked ? "Remove bookmark" : "Bookmark thread",
          action: () => void toggleBookmark(menu.thread.id, !menu.thread.bookmarked),
        },
        { label: revealWorkspaceLabel(), action: () => void revealWorkspace(menu.workspaceId) },
        {
          label: "Delete thread",
          danger: true,
          disabled: isRunning(menu.thread.id),
          action: () => void deleteThread(menu.thread),
        },
      ]
    : menu?.kind === "workspace"
      ? [
          {
            label: "Open workspace",
            disabled: menu.workspace.id === state.workspace?.id,
            action: () => void selectWorkspace(menu.workspace.id),
          },
          { label: "New chat thread", action: () => void newThreadIn(menu.workspace.id) },
          { label: revealWorkspaceLabel(), action: () => void revealWorkspace(menu.workspace.id) },
          {
            label: "Remove workspace",
            danger: true,
            disabled: menu.workspace.threads.some((thread) => isRunning(thread.id)),
            action: () => void removeWorkspace(menu.workspace.id, menu.workspace.name),
          },
        ]
      : [];

  function handleThreadKeys(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!selecting) return;
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
    if (event.key === " " && event.target === event.currentTarget && orderedThreads[cursor]) {
      event.preventDefault();
      const id = orderedThreads[cursor].id;
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
    const next = Math.max(0, Math.min(orderedThreads.length - 1, cursor + movement));
    setCursor(next);
    if (event.shiftKey) {
      const start = Math.min(anchor, next);
      const end = Math.max(anchor, next);
      setSelectedIds(
        orderedThreads.slice(start, end + 1).filter((thread) => !isRunning(thread.id)).map((thread) => thread.id),
      );
    } else {
      setAnchor(next);
    }
  }

  return (
    <aside
      ref={sidebarRoot}
      className={collapsed ? "left-sidebar collapsed" : "left-sidebar"}
      aria-label={
        view === "conversation"
          ? "Workspaces and threads"
          : view === "settings"
            ? "Settings navigation"
            : view === "saved"
              ? "Bookmarks"
              : "Search"
      }
      aria-hidden={collapsed}
    >
      <header className="sidebar-brand">
        {view === "settings" || view === "saved" ? (
          <span>{view === "settings" ? "Settings" : "Bookmarks"}</span>
        ) : (
          <span className="brand-leading">
            <span className="brand-wordmark" aria-label={PROJECT.name}>
              <span className="brand-name">{PROJECT.name}</span>
            </span>
            <button
              className={view === "search" ? "brand-search active" : "brand-search"}
              type="button"
              onClick={() => {
                onError(null);
                onView("search");
              }}
              aria-label="Search conversations"
              title={`Search conversations (${window.desktop.platform === "darwin" ? "⌘K" : "Ctrl+K"})`}
            >
              <SearchSidebarIcon />
            </button>
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
          view !== "conversation"
            ? `sidebar-navigation settings-navigation${view === "settings" ? " settings-page-navigation" : ""} view-enter`
            : "sidebar-navigation workspace-sidebar-navigation view-enter"
        }
      >
        {view === "search" ? (
          <>
            <button className="sidebar-action active" type="button" aria-current="page">
              <SearchSidebarIcon />
              <span>Search</span>
            </button>
            <div className="settings-navigation-space" aria-hidden="true" />
          </>
        ) : view === "settings" ? (
          <>
            <button
              className="sidebar-action"
              type="button"
              onClick={() => {
                onError(null);
                onView("search");
              }}
            >
              <SearchSidebarIcon />
              <span>Search</span>
            </button>
            <button
              className={settingsPage === "appearance" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("appearance")}
            >
              <span>Appearance</span>
            </button>
            <button
              className={settingsPage === "providers" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("providers")}
            >
              <span>Providers</span>
            </button>
            <button
              className={settingsPage === "editor" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("editor")}
            >
              <span>Editor</span>
            </button>
            <button
              className={settingsPage === "agent" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("agent")}
            >
              <span>Agent</span>
            </button>
            <button
              className={settingsPage === "model" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("model")}
            >
              <span>Model surface</span>
            </button>
            <button
              className={settingsPage === "context" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("context")}
            >
              <span>Context</span>
            </button>
            <button
              className={settingsPage === "web" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("web")}
            >
              <span>Web</span>
            </button>
            <button
              className={settingsPage === "mcp" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onSettingsPage("mcp")}
            >
              <span>MCP</span>
            </button>
            <div className="settings-navigation-space" aria-hidden="true" />
          </>
        ) : view === "saved" ? (
          <>
            <button
              className={bookmarksPage === "threads" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onBookmarksPage("threads")}
            >
              <span>Threads</span>
            </button>
            <button
              className={bookmarksPage === "messages" ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={() => onBookmarksPage("messages")}
            >
              <span>Messages</span>
            </button>
            <div className="settings-navigation-space" aria-hidden="true" />
          </>
        ) : (
          <div key={state.workspace?.id ?? "empty"} className="workspace-navigation workspace-enter">
            <div className="workspace-create-actions">
              <button
                className="workspace-create-button primary"
                type="button"
                onClick={() => void newThread()}
                disabled={!state.workspace}
              >
                <PlusIcon />
                <span>New chat thread</span>
              </button>
              <button
                className="workspace-create-button secondary"
                type="button"
                onClick={() => void chooseWorkspace()}
                aria-label="Open workspace"
                title="Open workspace"
              >
                <PlusIcon />
                <span>New workspace</span>
              </button>
            </div>

            <div className="section-heading workspace-heading">
              <h2>Workspace</h2>
            </div>

            {state.workspace ? (
              <>
                <div
                  className="sidebar-row workspace-row active"
                  onContextMenu={(event) => openWorkspaceMenu(event, state.workspace!)}
                >
                  <div className="workspace-item" title={state.workspace.path}>
                    <WorkspaceIcon open />
                    <span>{state.workspace.name}</span>
                  </div>
                  <span className="thread-actions">
                    <button
                      className="row-action thread-action"
                      type="button"
                      onClick={() => void newThread()}
                      aria-label={`New thread in ${state.workspace.name}`}
                      title="New thread"
                    >
                      <PlusIcon />
                    </button>
                    <button
                      className={
                        selecting ? "row-action thread-action active" : "row-action thread-action"
                      }
                      type="button"
                      onClick={() => {
                        setSelecting((value) => !value);
                        setSelectedIds([]);
                      }}
                      aria-label="Manage threads"
                      aria-pressed={selecting}
                      title="Manage threads"
                    >
                      <PencilIcon />
                    </button>
                  </span>
                </div>
                <div
                  ref={threadList}
                  className="threads"
                  tabIndex={selecting ? 0 : -1}
                  onKeyDown={handleThreadKeys}
                  aria-label={selecting ? "Manage threads" : undefined}
                >
                  <div className="thread-list">
                    {orderedThreads.map((thread, index) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        sourceTitle={threads.find((candidate) => candidate.id === thread.sourceThreadId)?.title}
                        active={thread.id === state.activeThreadId || thread.id === promotedThreadId}
                        selected={thread.id === state.activeThreadId}
                        bridged={thread.id === promotedThreadId}
                        promotionDistance={promotion?.id === thread.id ? promotion.distance : 0}
                        demotionDistance={promotion?.previousId === thread.id ? promotion.distance : 0}
                        selecting={selecting}
                        checked={selectedIds.includes(thread.id)}
                        focused={selecting && index === cursor}
                        running={isRunning(thread.id)}
                        onSelect={() => void selectThread(thread.id)}
                        {...(thread.sourceThreadId && thread.sourceEntryId
                          ? { onOpenSource: () => onOpenThreadSource(thread) }
                          : {})}
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
                        onContextMenu={(event) => openThreadMenu(event, thread)}
                      />
                    ))}
                    {selecting ? (
                      <div className="thread-selection-actions">
                        <button
                          className="workspace-delete-action"
                          type="button"
                          disabled={state.workspace.threads.some((thread) => isRunning(thread.id))}
                          onClick={() =>
                            void removeWorkspace(state.workspace!.id, state.workspace!.name)
                          }
                        >
                          Delete workspace
                        </button>
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

                {inactiveWorkspaces.length ? (
                  <div className="inactive-workspaces">
                    <div className="section-heading">
                      <h2>Other workspaces</h2>
                    </div>
                    {inactiveWorkspaces.map((workspace) => (
                      <div
                        className="sidebar-row workspace-row"
                        key={workspace.id}
                        onContextMenu={(event) => openWorkspaceMenu(event, workspace)}
                      >
                        <button
                          className="workspace-item"
                          type="button"
                          onClick={() => void selectWorkspace(workspace.id)}
                          title={workspace.path}
                        >
                          <WorkspaceIcon />
                          <span>{workspace.name}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </nav>

      {menu ? (
        <SidebarContextMenu
          top={menu.top}
          left={menu.left}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      ) : null}

      <footer className="sidebar-footer">
        {view !== "conversation" ? (
          <button className="sidebar-action" type="button" onClick={() => onView("conversation")}>
            <span aria-hidden="true">←</span>
            <span>Back to chat</span>
          </button>
        ) : (
          <>
            <button
              className={terminalOpen ? "sidebar-action active" : "sidebar-action"}
              type="button"
              onClick={onTerminal}
              aria-pressed={terminalOpen}
            >
              <TerminalSidebarIcon />
              <span>Terminal</span>
            </button>
            <button
              className="sidebar-action"
              type="button"
              onClick={() => {
                onError(null);
                onView("saved");
              }}
            >
              <SavedIcon />
              <span>Bookmarks</span>
            </button>
            <button
              className="sidebar-action"
              type="button"
              onClick={() => {
                onError(null);
                onView("settings");
              }}
            >
              <span className="sidebar-settings-icon" aria-hidden="true">⚙</span>
              <span>Settings</span>
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

function ThreadRow({
  thread,
  sourceTitle,
  active,
  selected,
  bridged,
  promotionDistance,
  demotionDistance,
  selecting,
  checked,
  focused,
  running,
  onSelect,
  onOpenSource,
  onToggleSelected,
  onToggleBookmark,
  onDelete,
  onContextMenu,
}: {
  thread: DesktopThread;
  sourceTitle: string | undefined;
  active: boolean;
  selected: boolean;
  bridged: boolean;
  promotionDistance: number;
  demotionDistance: number;
  selecting: boolean;
  checked: boolean;
  focused: boolean;
  running: boolean;
  onSelect: () => void;
  onOpenSource?: () => void;
  onToggleSelected: () => void;
  onToggleBookmark: () => void;
  onDelete: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
}): JSX.Element {
  let className = "sidebar-row thread-row";
  if (active) className += " active";
  if (selected) className += " selected";
  if (bridged) className += " bridged";
  if (promotionDistance) className += " promoted";
  if (demotionDistance) className += " demoted";
  if (focused) className += " focused";

  const motionDistance = promotionDistance || demotionDistance;

  return (
    <div
      className={className}
      style={motionDistance ? { "--thread-rise-distance": `${motionDistance}px` } as CSSProperties : undefined}
      onContextMenu={onContextMenu}
    >
      {selecting ? (
        <input
          className="selection-checkbox"
          type="checkbox"
          checked={checked}
          onChange={onToggleSelected}
          disabled={running}
          aria-label={`Select ${thread.title}`}
        />
      ) : null}
      {!selecting && onOpenSource ? (
        <button
          className="thread-fork-marker"
          type="button"
          onClick={onOpenSource}
          title={`Open source: ${sourceTitle ?? "source thread"}`}
          aria-label={`Open source thread ${sourceTitle ?? ""}`.trim()}
        >
          <ThreadForkIcon />
        </button>
      ) : null}
      <button
        className="thread-item"
        type="button"
        onClick={selecting ? onToggleSelected : onSelect}
        title={thread.sourceThreadId
          ? `${thread.title} — Forked from ${sourceTitle ?? "another thread"}`
          : thread.title}
      >
        <span className="thread-title-row">
          {running ? (
            <span className="thread-running" title="Running" aria-label="Running">
              <ThinkingOrb motion="active" speed={1.7} />
            </span>
          ) : null}
          <span className="thread-title-text">{thread.title}</span>
        </span>
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

function ThreadForkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M4 4.5v2.25A5.25 5.25 0 0 0 9.25 12H10.5M4 6.5A5.5 5.5 0 0 1 9.5 5H10.5" />
    </svg>
  );
}

function SavedIcon(): JSX.Element {
  return (
    <svg className="sidebar-action-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5h8v11l-4-2.5-4 2.5z" />
    </svg>
  );
}

function SearchSidebarIcon(): JSX.Element {
  return (
    <svg className="sidebar-action-icon search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.4 15.4 4.6 4.6" />
    </svg>
  );
}

function TerminalSidebarIcon(): JSX.Element {
  return (
    <svg className="sidebar-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m4 5 4 4-4 4m6 0h6" />
    </svg>
  );
}

function WorkspaceIcon({ open = false }: { open?: boolean }): JSX.Element {
  return (
    <span className="workspace-icon" aria-hidden="true">
      <svg viewBox="0 0 18 14" fill="none">
        {open ? (
          <>
            <path
              d="M2 11.5V3.75c0-.7.56-1.25 1.25-1.25h3.3c.45 0 .87.2 1.15.55L8.9 4.5h5.85c.7 0 1.25.56 1.25 1.25v1"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="folder-flap"
              d="M2 11.5 3.7 6.25h12.4l-1.7 5.25z"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <path
            d="M2 11.5V3.75c0-.7.56-1.25 1.25-1.25h3.3c.45 0 .87.2 1.15.55L8.9 4.5h5.85c.7 0 1.25.56 1.25 1.25v5.75z"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function menuPosition(event: ReactMouseEvent): { top: number; left: number } {
  return {
    top: Math.max(8, Math.min(event.clientY, window.innerHeight - 190)),
    left: Math.max(8, Math.min(event.clientX, window.innerWidth - 218)),
  };
}

function revealWorkspaceLabel(): string {
  if (window.desktop.platform === "darwin") return "Reveal workspace in Finder";
  if (window.desktop.platform === "win32") return "Reveal workspace in Explorer";
  return "Reveal workspace in file manager";
}
