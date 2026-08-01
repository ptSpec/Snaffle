import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DesktopApi, DesktopState } from "../api.js";
import { PRODUCT } from "../../identity.js";
import type { OpenRouterModel } from "../../providers/openrouter.js";
import {
  addRunEvent,
  Inspector,
  newTimelineId,
  TimelineEntry,
  type TimelineItem,
} from "./timeline.js";

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

const initialState: DesktopState = {
  workspace: null,
  openRouterAvailable: false,
  runActive: false,
  defaultModel: null,
  unsafeHostDefault: false,
};

export function App(): JSX.Element {
  const [desktopState, setDesktopState] = useState(initialState);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [choosingModel, setChoosingModel] = useState(false);
  const [task, setTask] = useState("");
  const [unsafeHostExecution, setUnsafeHostExecution] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(250);
  const [rightWidth, setRightWidth] = useState(320);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const timelineView = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const input = taskInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [task]);

  useLayoutEffect(() => {
    const view = timelineView.current;
    if (view) view.scrollTop = view.scrollHeight;
  }, [timeline]);

  useEffect(() => {
    void window.desktop
      .getState()
      .then((state) => {
        setDesktopState(state);
        setRunning(state.runActive);
        setSelectedModel(state.defaultModel ?? "");
        setUnsafeHostExecution(state.unsafeHostDefault);
        if (state.openRouterAvailable) void loadModels();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));

    return window.desktop.onRunEvent((event) => {
      addRunEvent(event, setTimeline);

      if (event.type === "run.started") setRunning(true);
      if (event.type === "run.completed" || event.type === "run.failed") setRunning(false);
    });
  }, []);

  const selectedItem = useMemo(
    () => timeline.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, timeline],
  );
  const visibleLeftWidth = leftCollapsed ? 0 : leftWidth;
  const visibleRightWidth = rightCollapsed ? 0 : rightWidth;

  const runBlocker = !desktopState.workspace
    ? "Open a workspace before sending."
    : !task.trim()
      ? "Describe a task before sending."
      : !selectedModel
        ? "Select a model before sending."
        : !unsafeHostExecution
          ? "Enable unsafe host execution before sending."
          : null;

  async function chooseWorkspace(): Promise<void> {
    setError(null);

    try {
      const workspace = await window.desktop.chooseWorkspace();
      if (!workspace) return;
      if (desktopState.workspace?.path !== workspace.path) {
        setTimeline([]);
        setSelectedItemId(null);
      }
      setDesktopState((state) => ({ ...state, workspace }));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

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

    if (running || runBlocker) {
      if (runBlocker) setError(runBlocker);
      return;
    }

    const request = {
      task: task.trim(),
      model: selectedModel,
      unsafeHostExecution,
    };

    setTimeline((items) => [
      ...items,
      { id: newTimelineId(), kind: "user", text: request.task },
    ]);
    setTask("");
    setRunning(true);

    try {
      await window.desktop.startRun(request);
    } catch (cause) {
      setRunning(false);
      setError(errorMessage(cause));
    }
  }

  async function stopRun(): Promise<void> {
    setError(null);

    try {
      await window.desktop.stopRun();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function newThread(): Promise<void> {
    if (running) return;
    try {
      await window.desktop.resetConversation();
      setTimeline([]);
      setSelectedItemId(null);
      setTask("");
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
        <aside
          className={leftCollapsed ? "left-sidebar collapsed" : "left-sidebar"}
          aria-label="Workspaces and threads"
          aria-hidden={leftCollapsed}
        >
          <header className="sidebar-brand">
            <span>{PRODUCT.name}</span>
            <button
              className="panel-toggle"
              type="button"
              onClick={() => setLeftCollapsed(true)}
              aria-label="Hide workspace sidebar"
              title="Hide sidebar"
            >
              <span className="pane-icon left" aria-hidden="true" />
            </button>
          </header>

          <nav className="sidebar-navigation">
            <div className="section-heading">
              <h2>Workspaces</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => void chooseWorkspace()}
                disabled={running}
                aria-label="Open workspace"
                title="Open workspace"
              >
                +
              </button>
            </div>

            {desktopState.workspace ? (
              <>
                <button
                  className="workspace-item active"
                  type="button"
                  onClick={() => void chooseWorkspace()}
                  disabled={running}
                  title={desktopState.workspace.path}
                >
                  <span className="workspace-icon" aria-hidden="true">▱</span>
                  <span>{desktopState.workspace.name}</span>
                </button>

                <div className="threads">
                  <div className="section-heading">
                    <h2>Threads</h2>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => void newThread()}
                      disabled={running}
                      aria-label="New thread"
                      title="New thread"
                    >
                      +
                    </button>
                  </div>
                  <button className="thread-item active" type="button">
                    Current thread
                  </button>
                </div>
              </>
            ) : (
              <button
                className="workspace-item"
                type="button"
                onClick={() => void chooseWorkspace()}
              >
                <span className="workspace-icon" aria-hidden="true">+</span>
                <span>Open workspace</span>
              </button>
            )}
          </nav>

          <footer className="sidebar-footer">
            <button className="sidebar-action" type="button" disabled title="Settings are coming later">
              <span aria-hidden="true">⚙</span>
              <span>Settings</span>
            </button>
          </footer>
        </aside>

        <section className="conversation" aria-label="Conversation">
          <div ref={timelineView} className="timeline" aria-live="polite">
            {timeline.map((item) => (
              <TimelineEntry
                key={item.id}
                item={item}
                selected={item.id === selectedItemId}
                onSelect={setSelectedItemId}
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

        <aside
          className={rightCollapsed ? "inspector collapsed" : "inspector"}
          aria-label="Inspector"
          aria-hidden={rightCollapsed}
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

          {selectedItem ? <Inspector item={selectedItem} /> : null}

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
        {rightCollapsed ? (
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
