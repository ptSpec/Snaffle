import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CommandApprovalDecision } from "../../protocol.js";
import type { DesktopApi, DesktopRunEvent, DesktopState, SavedMessage } from "../api.js";
import type { OpenRouterModel } from "../../providers/openrouter.js";
import { DEFAULT_THEME, themeById, type Theme } from "../themes/index.js";
import { Settings } from "./settings.js";
import { SavedMessages } from "./saved-messages.js";
import { Sidebar, type AppView, type SettingsPage } from "./sidebar.js";
import { InspectorPanel, type InspectorTab } from "./inspector/panel.js";
import { SearchPicker } from "./search-picker.js";
import { ThinkingOrb, type OrbMotion } from "./thinking-orb.js";
import {
  addRunEvent,
  findTimelineItem,
  newTimelineId,
  TimelineEntry,
  timelineFromEntries,
  type SaveableTimelineItem,
  type TimelineItem,
} from "./timeline.js";

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

const initialState: DesktopState = {
  workspace: null,
  workspaces: [],
  activeThreadId: null,
  conversation: [],
  savedMessages: [],
  openRouterAvailable: false,
  runningThreadIds: [],
  unsafeThreadIds: [],
  defaultModel: null,
  restrictedHostAvailable: false,
  restrictedHostDetail: "Checking restricted execution…",
  themeId: document.documentElement.dataset.theme ?? DEFAULT_THEME.id,
  editorFontSize: 13,
  editorCommand: "",
  editorArguments: "",
  maxSteps: 50,
  providerTimeoutMinutes: 3,
  providerRetries: 2,
};

export function App(): JSX.Element {
  const [desktopState, setDesktopState] = useState(initialState);
  const [savedMessages, setSavedMessages] = useState<SavedMessage[] | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [task, setTask] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(250);
  const [rightWidth, setRightWidth] = useState(320);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("inspect");
  const [view, setView] = useState<AppView>("conversation");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  const [sendOrbMotion, setSendOrbMotion] = useState<OrbMotion>("stopped");
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const timelineView = useRef<HTMLDivElement>(null);
  const executionMode = useRef<HTMLDetailsElement>(null);
  const followTimeline = useRef(true);
  const leftAutoCollapsed = useRef(false);
  const activeThreadId = useRef<string | null>(null);
  const threadTimelines = useRef(new Map<string, TimelineItem[]>());
  const running = desktopState.activeThreadId
    ? desktopState.runningThreadIds.includes(desktopState.activeThreadId)
    : false;
  const unsafeHostExecution = desktopState.activeThreadId
    ? desktopState.unsafeThreadIds.includes(desktopState.activeThreadId)
    : false;

  useLayoutEffect(() => {
    const input = taskInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [task]);

  useLayoutEffect(() => {
    const view = timelineView.current;
    if (view && followTimeline.current) view.scrollTop = view.scrollHeight;
  }, [timeline]);

  useEffect(() => {
    if (!running && view === "conversation") {
      taskInput.current?.focus({ preventScroll: true });
    }
  }, [desktopState.activeThreadId, running, view]);

  useEffect(() => {
    if (running) {
      setSendOrbMotion("active");
      return;
    }
    setSendOrbMotion((motion) => (motion === "active" ? "settling" : motion));
  }, [running]);

  useEffect(() => {
    if (sendOrbMotion !== "settling") return;
    const timer = window.setTimeout(() => setSendOrbMotion("stopped"), 2300);
    return () => window.clearTimeout(timer);
  }, [sendOrbMotion]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${desktopState.editorFontSize}px`);
  }, [desktopState.editorFontSize]);

  useEffect(() => {
    let reopenTimer: number | undefined;

    function updateSidebarForInspector(): void {
      if (reopenTimer !== undefined) {
        window.clearTimeout(reopenTimer);
        reopenTimer = undefined;
      }
      if (view !== "conversation" || rightCollapsed) return;

      if (rightWidth > window.innerWidth / 2) {
        setLeftCollapsed((collapsed) => {
          if (collapsed) return true;
          leftAutoCollapsed.current = true;
          return true;
        });
      } else if (rightWidth < window.innerWidth * 0.4 && leftAutoCollapsed.current) {
        reopenTimer = window.setTimeout(() => {
          leftAutoCollapsed.current = false;
          setLeftCollapsed(false);
        }, 500);
      }
    }

    updateSidebarForInspector();
    window.addEventListener("resize", updateSidebarForInspector);
    return () => {
      if (reopenTimer !== undefined) window.clearTimeout(reopenTimer);
      window.removeEventListener("resize", updateSidebarForInspector);
    };
  }, [rightCollapsed, rightWidth, view]);

  useEffect(() => {
    function closeExecutionMode(event: PointerEvent): void {
      const details = executionMode.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }

    document.addEventListener("pointerdown", closeExecutionMode);
    return () => document.removeEventListener("pointerdown", closeExecutionMode);
  }, []);

  useEffect(() => {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    const timeout = window.setTimeout(() => {
      void window.desktop.setThreadDraft(threadId, task).catch((cause) => {
        setError(errorMessage(cause));
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [desktopState.activeThreadId, task]);

  useEffect(() => {
    if (view !== "saved") {
      setSavedMessages(null);
      return;
    }
    let current = true;
    void window.desktop.listSavedMessages().then(
      (messages) => { if (current) setSavedMessages(messages); },
      (cause: unknown) => { if (current) setError(errorMessage(cause)); },
    );
    return () => { current = false; };
  }, [view]);

  useEffect(() => {
    let queuedEvents: DesktopRunEvent[] = [];
    let flushTimer: number | undefined;

    function applyRunEvent({ threadId, event }: DesktopRunEvent): void {
      if (event.type === "run.persisted" && activeThreadId.current !== threadId) {
        threadTimelines.current.delete(threadId);
        return;
      }
      addRunEvent(event, (update) => {
        const next = update(threadTimelines.current.get(threadId) ?? []);
        threadTimelines.current.set(threadId, next);
        if (activeThreadId.current === threadId) setTimeline(next);
      });

      if (event.type === "run.started") {
        setDesktopState((state) => ({
          ...state,
          runningThreadIds: [...new Set([...state.runningThreadIds, threadId])],
        }));
      }
      if (event.type === "run.completed" || event.type === "run.failed") {
        setDesktopState((state) => ({
          ...state,
          runningThreadIds: state.runningThreadIds.filter((id) => id !== threadId),
        }));
      }
    }

    function flushEvents(): void {
      flushTimer = undefined;
      const events = queuedEvents;
      queuedEvents = [];
      events.forEach(applyRunEvent);
    }

    void window.desktop
      .getState()
      .then((state) => {
        activeThreadId.current = state.activeThreadId;
        const initialTimeline = timelineFromEntries(state.conversation);
        setDesktopState(withoutConversation(state));
        if (state.activeThreadId) threadTimelines.current.set(state.activeThreadId, initialTimeline);
        setTimeline(initialTimeline);
        setTask(activeDraft(state));
        setSelectedModel(state.defaultModel ?? "");
        if (state.openRouterAvailable) void loadModels();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));

    const unsubscribe = window.desktop.onRunEvent((event) => {
      const previous = queuedEvents.at(-1);
      if (!previous || !mergeStreamEvent(previous, event)) queuedEvents.push(event);
      flushTimer ??= window.setTimeout(flushEvents, 16);
    });

    return () => {
      unsubscribe();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    };
  }, []);

  const selectedItem = useMemo(
    () => findTimelineItem(timeline, selectedItemId),
    [selectedItemId, timeline],
  );
  const visibleLeftWidth = leftCollapsed ? 0 : leftWidth;
  const visibleRightWidth = view !== "conversation" || rightCollapsed ? 0 : rightWidth;
  const runBlocker = !desktopState.workspace
    ? "Open a workspace before sending."
    : !task.trim()
      ? "Describe a task before sending."
      : !selectedModel
        ? "Select a model before sending."
        : !unsafeHostExecution && !desktopState.restrictedHostAvailable
          ? desktopState.restrictedHostDetail
          : null;

  async function loadModels(): Promise<void> {
    setError(null);
    setLoadingModels(true);

    try {
      setModels(await window.desktop.listOpenRouterModels());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingModels(false);
    }
  }

  async function startRun(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const threadId = desktopState.activeThreadId;

    if (!threadId || running || runBlocker) {
      if (runBlocker) setError(runBlocker);
      return;
    }

    const request = {
      threadId,
      task: task.trim(),
      model: selectedModel,
    };

    followTimeline.current = true;
    setTimeline((items) => {
      const next = [
        ...items,
        {
          id: newTimelineId(),
          kind: "user" as const,
          text: request.task,
          sequence: nextMessageSequence(items),
        },
      ];
      threadTimelines.current.set(request.threadId, next);
      return next;
    });
    setTask("");
    setDesktopState((state) => ({
      ...state,
      runningThreadIds: [...new Set([...state.runningThreadIds, request.threadId])],
    }));

    try {
      await window.desktop.startRun(request);
    } catch (cause) {
      setDesktopState((state) => ({
        ...state,
        runningThreadIds: state.runningThreadIds.filter((id) => id !== request.threadId),
      }));
      setError(errorMessage(cause));
    }
  }

  async function stopRun(): Promise<void> {
    setError(null);
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;

    try {
      await window.desktop.stopRun(threadId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setThreadUnsafe(unsafe: boolean): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.setThreadUnsafe(threadId, unsafe)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function resolveCommandApproval(
    id: string,
    decision: CommandApprovalDecision,
  ): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.resolveCommandApproval(id, decision)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function showDesktopState(state: DesktopState): void {
    followTimeline.current = true;
    trimThreadTimelines(threadTimelines.current, state.activeThreadId, state.runningThreadIds);
    activeThreadId.current = state.activeThreadId;
    const storedTimeline = state.activeThreadId
      ? threadTimelines.current.get(state.activeThreadId)
      : undefined;
    const nextTimeline = storedTimeline ?? timelineFromEntries(state.conversation);
    setDesktopState(withoutConversation(state));
    if (state.activeThreadId && !storedTimeline) {
      threadTimelines.current.set(state.activeThreadId, nextTimeline);
    }
    setTimeline(nextTimeline);
    setSelectedItemId(null);
    setTask(activeDraft(state));
    setError(null);
    setView("conversation");
  }

  async function saveDraft(): Promise<void> {
    if (desktopState.activeThreadId) {
      await window.desktop.setThreadDraft(desktopState.activeThreadId, task);
    }
  }

  function savedIdFor(item: SaveableTimelineItem): string | undefined {
    const threadId = desktopState.activeThreadId;
    if (!threadId || item.sequence === undefined) return undefined;
    return desktopState.savedMessages.find(
      (saved) =>
        (item.entryId ? saved.sourceEntryId === item.entryId : false) ||
        (saved.sourceThreadId === threadId &&
          saved.sourceSequence === item.sequence),
    )?.id;
  }

  async function toggleSavedMessage(item: SaveableTimelineItem, savedId?: string): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId || item.sequence === undefined) return;
    try {
      const savedMessages = savedId
        ? await window.desktop.deleteSavedMessage(savedId)
        : await window.desktop.saveMessage({
            threadId,
            sequence: item.sequence,
            text: item.text,
            ...(item.kind === "assistant" && item.model ? { model: item.model } : {}),
          });
      setDesktopState((state) => ({ ...state, savedMessages }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function openSavedMessage(message: SavedMessage): Promise<void> {
    if (!message.sourceAvailable) return;
    try {
      await saveDraft();
      const source = await window.desktop.openSavedMessage(message.id);
      if (!source) {
        setDesktopState((state) => ({
          ...state,
          savedMessages: state.savedMessages.map((saved) =>
            saved.id === message.id ? { ...saved, sourceAvailable: false } : saved,
          ),
        }));
        setSavedMessages((messages) => messages?.map((saved) =>
          saved.id === message.id ? { ...saved, sourceAvailable: false } : saved
        ) ?? null);
        return;
      }
      if (source.state.activeThreadId) threadTimelines.current.delete(source.state.activeThreadId);
      showDesktopState(source.state);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          timelineView.current
            ?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(source.entryId)}"]`)
            ?.scrollIntoView({ block: "center" });
        });
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function deleteSavedMessage(id: string): Promise<void> {
    try {
      const savedMessages = await window.desktop.deleteSavedMessage(id);
      setDesktopState((state) => ({ ...state, savedMessages }));
      setSavedMessages((messages) => messages?.filter((message) => message.id !== id) ?? null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function selectTheme(themeId: string): Promise<void> {
    const theme = themeById(themeId);
    if (!theme) return;

    try {
      await window.desktop.setTheme(theme.id);
      applyTheme(theme);
      setDesktopState((state) => ({ ...state, themeId: theme.id }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setMaxSteps(maxSteps: number): Promise<void> {
    try {
      await window.desktop.setMaxSteps(maxSteps);
      setDesktopState((state) => ({ ...state, maxSteps }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setEditorFontSize(editorFontSize: number): Promise<void> {
    try {
      await window.desktop.setEditorFontSize(editorFontSize);
      setDesktopState((state) => ({ ...state, editorFontSize }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setEditorLauncher(editorCommand: string, editorArguments: string): Promise<void> {
    try {
      await window.desktop.setEditorLauncher(editorCommand, editorArguments);
      setDesktopState((state) => ({ ...state, editorCommand, editorArguments }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function chooseEditorApplication(): Promise<void> {
    try {
      const command = await window.desktop.chooseEditorApplication();
      if (command) await setEditorLauncher(command, desktopState.editorArguments);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setProviderTimeoutMinutes(providerTimeoutMinutes: number): Promise<void> {
    try {
      await window.desktop.setProviderTimeoutMinutes(providerTimeoutMinutes);
      setDesktopState((state) => ({ ...state, providerTimeoutMinutes }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setProviderRetries(providerRetries: number): Promise<void> {
    try {
      await window.desktop.setProviderRetries(providerRetries);
      setDesktopState((state) => ({ ...state, providerRetries }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function beginResize(
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const otherWidth = side === "left" ? rightWidth : 0;
    const minimum = 220;

    function move(pointer: PointerEvent): void {
      const movement = side === "left" ? pointer.clientX - startX : startX - pointer.clientX;
      const limit = side === "left" ? 480 : 1200;
      const maximum = Math.max(minimum, Math.min(limit, window.innerWidth - otherWidth - 360));
      const width = Math.min(maximum, Math.max(minimum, startWidth + movement));
      if (side === "left") setLeftWidth(width);
      else setRightWidth(width);
    }

    function stop(): void {
      window.removeEventListener("pointermove", move);
      document.body.classList.remove("resizing-columns");
    }

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <main className={`app-shell platform-${window.desktop.platform}`}>
      <section
        className="workspace-shell"
        style={{
          gridTemplateColumns: `${visibleLeftWidth}px minmax(360px, 1fr) ${visibleRightWidth}px`,
        }}
      >
        <Sidebar
          state={desktopState}
          runningThreadIds={desktopState.runningThreadIds}
          view={view}
          settingsPage={settingsPage}
          collapsed={leftCollapsed}
          beforeNavigate={saveDraft}
          onNavigate={showDesktopState}
          onUpdate={(state) => setDesktopState(withoutConversation(state))}
          onError={setError}
          onView={setView}
          onSettingsPage={(page) => {
            setSettingsPage(page);
            setError(null);
          }}
          onCollapse={() => {
            leftAutoCollapsed.current = false;
            setLeftCollapsed(true);
          }}
        />

        {view === "settings" ? (
          <Settings
            page={settingsPage}
            themeId={desktopState.themeId}
            editorFontSize={desktopState.editorFontSize}
            editorCommand={desktopState.editorCommand}
            editorArguments={desktopState.editorArguments}
            maxSteps={desktopState.maxSteps}
            providerTimeoutMinutes={desktopState.providerTimeoutMinutes}
            providerRetries={desktopState.providerRetries}
            error={error}
            onSelectTheme={(themeId) => void selectTheme(themeId)}
            onEditorFontSize={(size) => void setEditorFontSize(size)}
            onEditorLauncher={(command, argumentsTemplate) => void setEditorLauncher(command, argumentsTemplate)}
            onChooseEditor={() => void chooseEditorApplication()}
            onMaxSteps={(maxSteps) => void setMaxSteps(maxSteps)}
            onProviderTimeoutMinutes={(minutes) => void setProviderTimeoutMinutes(minutes)}
            onProviderRetries={(retries) => void setProviderRetries(retries)}
          />
        ) : view === "saved" ? (
          <SavedMessages
            messages={savedMessages ?? []}
            loading={savedMessages === null}
            onOpen={(message) => void openSavedMessage(message)}
            onDelete={(id) => void deleteSavedMessage(id)}
          />
        ) : (
          <section className="conversation view-enter" aria-label="Conversation">
          <div
            ref={timelineView}
            className="timeline"
            aria-live="polite"
            onScroll={(event) => {
              const view = event.currentTarget;
              followTimeline.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80;
            }}
          >
            {timeline.map((item) => (
              <TimelineEntry
                key={item.id}
                item={item}
                selectedId={selectedItemId}
                onSelect={(id) => {
                  setSelectedItemId(id);
                  setInspectorTab("inspect");
                  setRightCollapsed(false);
                }}
                onResolveApproval={(id, decision) => void resolveCommandApproval(id, decision)}
                savedId={
                  item.kind === "assistant"
                    ? savedIdFor(item)
                    : undefined
                }
                onToggleSaved={(message, savedId) => void toggleSavedMessage(message, savedId)}
                onEditUser={(text) => {
                  setTask(text);
                  window.requestAnimationFrame(() => {
                    const input = taskInput.current;
                    input?.focus();
                    input?.setSelectionRange(text.length, text.length);
                  });
                }}
              />
            ))}
          </div>

          <form className="composer" onSubmit={(event) => void startRun(event)}>
            <textarea
              ref={taskInput}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder="Describe the coding task…"
              rows={1}
              disabled={running}
            />

            <div className="composer-controls">
              <SearchPicker
                className={selectedModel ? "model-search" : "model-search empty"}
                value={selectedModel}
                options={models.map((model) => ({ value: model.id, label: model.name }))}
                placeholder={loadingModels ? "Loading models…" : "Select model"}
                searchPlaceholder="Search models…"
                disabled={loadingModels || !desktopState.openRouterAvailable || running}
                allowCustom
                onChange={setSelectedModel}
              />

              <details
                ref={executionMode}
                className={unsafeHostExecution ? "execution-mode unsafe" : "execution-mode"}
              >
                <summary>
                  {unsafeHostExecution ? (
                    <span className="execution-dot" aria-hidden="true" />
                  ) : (
                    <svg className="execution-shield" viewBox="0 0 16 18" aria-hidden="true">
                      <path d="M8 1 14 3.4v4.3c0 3.9-2.5 7.1-6 8.3-3.5-1.2-6-4.4-6-8.3V3.4L8 1Z" />
                    </svg>
                  )}
                  {unsafeHostExecution ? "Unsafe · this thread" : "Restricted"}
                </summary>
                <div className="execution-details">
                  <button
                    className="execution-details-close"
                    type="button"
                    aria-label="Close execution settings"
                    title="Close"
                    onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
                  >
                    ×
                  </button>
                  <strong>
                    {unsafeHostExecution ? "Unrestricted host execution" : desktopState.restrictedHostDetail}
                  </strong>
                  <p>
                    {unsafeHostExecution
                      ? "Shell commands run as your user and can access host files, network, and inherited environment. File tools remain workspace-only."
                      : "Shell commands can write in this workspace and use private temporary files. Personal host files, network access, and Git metadata are blocked."}
                  </p>
                  <label className={unsafeHostExecution ? "host-toggle enabled" : "host-toggle"}>
                    <input
                      type="checkbox"
                      checked={unsafeHostExecution}
                      onChange={(event) => void setThreadUnsafe(event.target.checked)}
                      disabled={running}
                    />
                    {unsafeHostExecution ? "Return to restricted" : "Allow unrestricted shell commands"}
                  </label>
                </div>
              </details>

              <button
                className={running ? "send-button stop" : "send-button"}
                type={running ? "button" : "submit"}
                onClick={running ? () => void stopRun() : undefined}
                aria-label={running ? "Stop run" : "Send task"}
                aria-disabled={!running && Boolean(runBlocker)}
                title={running ? "Stop run" : runBlocker ?? "Send task"}
              >
                <span className="send-button-orb" aria-hidden="true">
                  <ThinkingOrb motion={sendOrbMotion} speed={1.7} />
                </span>
                <span className="send-button-symbol" aria-hidden="true">{running ? "■" : "↑"}</span>
              </button>
            </div>

            {error ? (
              <div className="composer-error" role="alert">
                {error}
              </div>
            ) : null}
          </form>
          </section>
        )}

        <aside
          className={view !== "conversation" || rightCollapsed ? "inspector collapsed" : "inspector"}
          aria-label="Context panel"
          aria-hidden={view !== "conversation" || rightCollapsed}
        >
          {view === "conversation" ? (
            <InspectorPanel
              workspace={desktopState.workspace}
              selectedItem={selectedItem}
              running={running}
              tab={inspectorTab}
              onTab={setInspectorTab}
              onCollapse={() => setRightCollapsed(true)}
            />
          ) : null}
        </aside>

        {leftCollapsed ? (
          <button
            className="panel-reopen left"
            type="button"
            onClick={() => {
              leftAutoCollapsed.current = false;
              setLeftCollapsed(false);
            }}
            aria-label="Show workspace sidebar"
            title="Show sidebar"
          >
            <span className="pane-icon left" aria-hidden="true" />
          </button>
        ) : (
          <div
            className="column-resizer left-resizer"
            style={{ left: leftWidth }}
            role="separator"
            aria-label="Resize workspace sidebar"
            aria-orientation="vertical"
            onPointerDown={(event) => beginResize("left", event)}
          />
        )}
        {view !== "conversation" ? null : rightCollapsed ? (
          <button
            className="panel-reopen right"
            type="button"
            onClick={() => setRightCollapsed(false)}
            aria-label="Show right panel"
            title="Show right panel"
          >
            <span className="pane-icon right" aria-hidden="true" />
          </button>
        ) : (
          <div
            className="column-resizer right-resizer"
            style={{ right: rightWidth }}
            role="separator"
            aria-label="Resize right panel"
            aria-orientation="vertical"
            onPointerDown={(event) => beginResize("right", event)}
          />
        )}
      </section>
    </main>
  );
}

function mergeStreamEvent(previous: DesktopRunEvent, next: DesktopRunEvent): boolean {
  if (previous.threadId !== next.threadId) return false;
  if (
    previous.event.type === "model.delta" &&
    next.event.type === "model.delta" &&
    previous.event.step === next.event.step
  ) {
    previous.event.text += next.event.text;
    return true;
  }
  if (
    previous.event.type === "model.reasoning.delta" &&
    next.event.type === "model.reasoning.delta" &&
    previous.event.step === next.event.step
  ) {
    previous.event.text += next.event.text;
    return true;
  }
  if (
    previous.event.type === "model.tool.delta" &&
    next.event.type === "model.tool.delta" &&
    previous.event.step === next.event.step &&
    previous.event.index === next.event.index
  ) {
    previous.event.name = next.event.name;
    previous.event.argumentChars = next.event.argumentChars;
    return true;
  }
  return false;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.appearance;
  for (const [name, value] of Object.entries(theme.colors)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function activeDraft(state: DesktopState): string {
  return state.workspace?.threads.find((thread) => thread.id === state.activeThreadId)?.draft ?? "";
}

function withoutConversation(state: DesktopState): DesktopState {
  return state.conversation.length ? { ...state, conversation: [] } : state;
}

function trimThreadTimelines(
  timelines: Map<string, TimelineItem[]>,
  activeId: string | null,
  runningIds: string[],
): void {
  const retained = new Set(runningIds);
  if (activeId) retained.add(activeId);
  for (const threadId of timelines.keys()) {
    if (!retained.has(threadId)) timelines.delete(threadId);
  }
}

function nextMessageSequence(items: TimelineItem[]): number {
  let highest = 0;
  for (const item of items) {
    if (item.kind === "activity-group") {
      highest = Math.max(highest, nextMessageSequence(item.items) - 1);
    } else if ("sequence" in item && item.sequence !== undefined) {
      highest = Math.max(highest, item.sequence);
    }
  }
  return highest + 1;
}
