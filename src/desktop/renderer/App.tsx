import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DesktopApi, DesktopRunEvent, DesktopState } from "../api.js";
import type { OpenRouterModel } from "../../providers/openrouter.js";
import { DEFAULT_THEME, themeById, type Theme } from "../themes/index.js";
import { Settings } from "./settings.js";
import { Sidebar, type AppView, type SettingsPage } from "./sidebar.js";
import {
  addRunEvent,
  findTimelineItem,
  Inspector,
  newTimelineId,
  TimelineEntry,
  timelineFromMessages,
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
  openRouterAvailable: false,
  runningThreadIds: [],
  defaultModel: null,
  unsafeHostDefault: false,
  themeId: document.documentElement.dataset.theme ?? DEFAULT_THEME.id,
  maxSteps: 50,
};

export function App(): JSX.Element {
  const [desktopState, setDesktopState] = useState(initialState);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [choosingModel, setChoosingModel] = useState(false);
  const [task, setTask] = useState("");
  const [unsafeHostExecution, setUnsafeHostExecution] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(250);
  const [rightWidth, setRightWidth] = useState(320);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [view, setView] = useState<AppView>("conversation");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const timelineView = useRef<HTMLDivElement>(null);
  const followTimeline = useRef(true);
  const activeThreadId = useRef<string | null>(null);
  const threadTimelines = useRef(new Map<string, TimelineItem[]>());
  const running = desktopState.activeThreadId
    ? desktopState.runningThreadIds.includes(desktopState.activeThreadId)
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
    let queuedEvents: DesktopRunEvent[] = [];
    let flushTimer: number | undefined;

    function applyRunEvent({ threadId, event }: DesktopRunEvent): void {
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
        setDesktopState(state);
        const initialTimeline = timelineFromMessages(state.conversation);
        if (state.activeThreadId) threadTimelines.current.set(state.activeThreadId, initialTimeline);
        setTimeline(initialTimeline);
        setTask(activeDraft(state));
        setSelectedModel(state.defaultModel ?? "");
        setUnsafeHostExecution(state.unsafeHostDefault);
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
  const visibleRightWidth = view === "settings" || rightCollapsed ? 0 : rightWidth;
  const runBlocker = !desktopState.workspace
    ? "Open a workspace before sending."
    : !task.trim()
      ? "Describe a task before sending."
      : !selectedModel
        ? "Select a model before sending."
        : !unsafeHostExecution
          ? "Enable unsafe host execution before sending."
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
      unsafeHostExecution,
    };

    followTimeline.current = true;
    setTimeline((items) => {
      const next = [...items, { id: newTimelineId(), kind: "user" as const, text: request.task }];
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

  function showDesktopState(state: DesktopState): void {
    followTimeline.current = true;
    activeThreadId.current = state.activeThreadId;
    setDesktopState(state);
    const storedTimeline = state.activeThreadId
      ? threadTimelines.current.get(state.activeThreadId)
      : undefined;
    const nextTimeline = storedTimeline ?? timelineFromMessages(state.conversation);
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

  function beginResize(
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const otherWidth = side === "left" ? rightWidth : leftWidth;
    const minimum = 220;

    function move(pointer: PointerEvent): void {
      const movement = side === "left" ? pointer.clientX - startX : startX - pointer.clientX;
      const maximum = Math.max(minimum, Math.min(480, window.innerWidth - otherWidth - 360));
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
          onUpdate={setDesktopState}
          onError={setError}
          onView={setView}
          onSettingsPage={(page) => {
            setSettingsPage(page);
            setError(null);
          }}
          onCollapse={() => setLeftCollapsed(true)}
        />

        {view === "settings" ? (
          <Settings
            page={settingsPage}
            themeId={desktopState.themeId}
            maxSteps={desktopState.maxSteps}
            error={error}
            onSelectTheme={(themeId) => void selectTheme(themeId)}
            onMaxSteps={(maxSteps) => void setMaxSteps(maxSteps)}
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
                onSelect={setSelectedItemId}
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
              <div className="model-search">
                {choosingModel ? (
                  <input
                    autoFocus
                    id="model"
                    list="openrouter-models"
                    value={modelQuery}
                    onChange={(event) => {
                      const model = event.currentTarget.value;
                      setModelQuery(model);
                      if (!models.some((item) => item.id === model)) return;
                      setSelectedModel(model);
                      setChoosingModel(false);
                    }}
                    onBlur={() => setChoosingModel(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setChoosingModel(false);
                      if (event.key !== "Enter" || !modelQuery.trim()) return;
                      event.preventDefault();
                      setSelectedModel(modelQuery.trim());
                      setChoosingModel(false);
                    }}
                    placeholder={loadingModels ? "Loading models…" : "Search models…"}
                    disabled={loadingModels || !desktopState.openRouterAvailable || running}
                    aria-label="OpenRouter model"
                  />
                ) : (
                  <button
                    className={selectedModel ? "model-choice" : "model-choice empty"}
                    type="button"
                    onClick={() => {
                      setModelQuery(selectedModel);
                      setChoosingModel(true);
                    }}
                    disabled={loadingModels || !desktopState.openRouterAvailable || running}
                  >
                    {loadingModels ? "Loading models…" : selectedModel || "Select model"}
                  </button>
                )}
                <datalist id="openrouter-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </datalist>
              </div>

              <label
                className={unsafeHostExecution ? "host-toggle enabled" : "host-toggle"}
                title="No container is active. The model can modify and run commands on the host."
              >
                <input
                  type="checkbox"
                  checked={unsafeHostExecution}
                  onChange={(event) => setUnsafeHostExecution(event.target.checked)}
                  disabled={running}
                />
                Unsafe host
              </label>

              {running ? (
                <button
                  className="send-button stop"
                  type="button"
                  onClick={() => void stopRun()}
                  aria-label="Stop run"
                  title="Stop run"
                >
                  <span aria-hidden="true">■</span>
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send task"
                  aria-disabled={Boolean(runBlocker)}
                  title={runBlocker ?? "Send task"}
                >
                  <span aria-hidden="true">↑</span>
                </button>
              )}
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
          className={view === "settings" || rightCollapsed ? "inspector collapsed" : "inspector"}
          aria-label="Inspector"
          aria-hidden={view === "settings" || rightCollapsed}
        >
          <div className="section-heading">
            <h2>Inspector</h2>
            <button
              className="panel-toggle"
              type="button"
              onClick={() => setRightCollapsed(true)}
              aria-label="Hide inspector"
              title="Hide inspector"
            >
              <span className="pane-icon right" aria-hidden="true" />
            </button>
          </div>

          {view === "conversation" && selectedItem ? <Inspector item={selectedItem} /> : null}

        </aside>

        {leftCollapsed ? (
          <button
            className="panel-reopen left"
            type="button"
            onClick={() => setLeftCollapsed(false)}
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
        {view === "settings" ? null : rightCollapsed ? (
          <button
            className="panel-reopen right"
            type="button"
            onClick={() => setRightCollapsed(false)}
            aria-label="Show inspector"
            title="Show inspector"
          >
            <span className="pane-icon right" aria-hidden="true" />
          </button>
        ) : (
          <div
            className="column-resizer right-resizer"
            style={{ right: rightWidth }}
            role="separator"
            aria-label="Resize inspector"
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
