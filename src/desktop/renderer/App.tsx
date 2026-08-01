import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

  return (
    <main className="app-shell">
      <section className="workspace-shell">
        <aside className="left-sidebar" aria-label="Workspaces and threads">
          <header className="sidebar-brand">{PRODUCT.name}</header>

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

        <aside className="inspector" aria-label="Inspector">
          <div className="section-heading">
            <h2>Inspector</h2>
          </div>

          {selectedItem ? <Inspector item={selectedItem} /> : null}

        </aside>
      </section>
    </main>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
