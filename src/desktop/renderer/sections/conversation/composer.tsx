import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  RefObject,
} from "react";
import { useEffect, useRef, useState } from "react";
import type {
  ProviderAllowance,
  ProviderCatalog,
  ReasoningEffort,
} from "../../../../providers/provider.js";
import { providerProfile } from "../../../../providers/profiles.js";
import type { ContextReport } from "../../../../context/report.js";
import { ThinkingOrb, type OrbMotion } from "../../components/thinking-orb.js";
import { ContextGauge } from "./context-gauge.js";
import { ModelPicker } from "./model-picker.js";
import { providerVisual } from "./provider-mark.js";
import { customToolChoices, type ModelToolSurface } from "../../../../capabilities/surface.js";
import type { SandboxAccessGrant, SandboxAccessInput } from "../../../../execution/access.js";

export function Composer({
  task,
  taskInput,
  executionMode,
  composerAdd,
  dragging,
  running,
  providerWait,
  pendingAttachmentCount,
  models,
  selectedProviderConnectionId,
  selectedModel,
  reasoningEffort,
  providerAllowance,
  toolSurface,
  activeToolNames,
  availableToolNames,
  loadingModels,
  providerAvailable,
  contextReport,
  pendingContextTokens,
  compactingContext,
  unsafe,
  restrictedDetail,
  sandboxAccess,
  sandboxNetworkEnabled,
  orbMotion,
  blocker,
  error,
  platform,
  queuedMessage,
  onTask,
  onSubmit,
  onDragging,
  onDrop,
  onPaste,
  onPastePlain,
  onPasteMarkdown,
  onChooseAttachments,
  onModel,
  onReasoningEffort,
  onProviderAllowance,
  onToolSurface,
  onCompact,
  onUnsafe,
  onChooseSandboxLocation,
  onAddSandboxAccess,
  onRemoveSandboxAccess,
  onSandboxNetworkEnabled,
  onStop,
  onQueue,
  onCancelQueued,
  onSlashCommand,
}: ComposerProps): JSX.Element {
  const [addingSandboxLocation, setAddingSandboxLocation] = useState(false);
  const [editingSandboxLocation, setEditingSandboxLocation] = useState<SandboxAccessGrant | null>(null);
  const [sandboxPath, setSandboxPath] = useState("");
  const [sandboxWritable, setSandboxWritable] = useState(true);
  const [sandboxScope, setSandboxScope] = useState<SandboxAccessInput["scope"]>("global");

  async function chooseSandboxLocation(): Promise<void> {
    const location = await onChooseSandboxLocation();
    if (location) setSandboxPath(location);
  }

  function closeSandboxLocationForm(): void {
    setAddingSandboxLocation(false);
    setEditingSandboxLocation(null);
    setSandboxPath("");
    setSandboxWritable(true);
    setSandboxScope("global");
  }

  function editSandboxLocation(location: SandboxAccessGrant): void {
    setEditingSandboxLocation(location);
    setSandboxPath(location.path);
    setSandboxWritable(location.writable);
    setSandboxScope(location.scope);
    setAddingSandboxLocation(true);
  }

  function saveSandboxLocation(): void {
    const location = sandboxPath.trim();
    if (!location) return;
    onAddSandboxAccess({ path: location, writable: sandboxWritable, scope: sandboxScope });
    closeSandboxLocationForm();
  }

  return (
    <form
      className={dragging ? "composer dragging" : "composer"}
      onSubmit={onSubmit}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) onDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) onDragging(false);
      }}
      onDrop={onDrop}
    >
      <textarea
        ref={taskInput}
        value={task}
        onChange={(event) => onTask(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (
            event.key === "/" && !task && !event.metaKey && !event.ctrlKey && !event.altKey &&
            !event.shiftKey && !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            onSlashCommand();
            return;
          }
          const pastePlain = event.key.toLowerCase() === "v" && event.shiftKey &&
            (platform === "darwin" ? event.metaKey : event.ctrlKey);
          if (pastePlain) {
            event.preventDefault();
            onPastePlain();
            return;
          }
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (running && event.altKey) {
            onQueue();
            return;
          }
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="Describe the coding task…"
        rows={1}
      />

      {queuedMessage ? (
        <div className="queued-follow-up">
          <span><strong>Queued next</strong> · {queuedMessage}</span>
          <button
            type="button"
            aria-label="Remove queued message"
            title="Remove queued message"
            onClick={onCancelQueued}
          >×</button>
        </div>
      ) : null}

      <div className="composer-controls">
        <details ref={composerAdd} className="composer-add">
          <summary aria-label="Add to message" title="Add to message">
            <svg className="composer-add-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </summary>
          <div className="composer-add-menu">
            <MenuButton label="Attach files" disabled={running || pendingAttachmentCount >= 8} onClick={onChooseAttachments} />
            <MenuButton label="Paste as Markdown" onClick={onPasteMarkdown} />
            <MenuButton label="Paste without formatting" onClick={onPastePlain} />
          </div>
        </details>
        <div className="adaptive-model-control">
          <ModelPicker
            value={selectedModel}
            providerId={selectedProviderConnectionId}
            providers={models.map(({ connection, models }) => {
              const visual = providerVisual(connection.baseUrl, connection.providerId);
              return {
                id: connection.id,
                name: connection.name,
                mark: visual.mark,
                logo: visual.logo,
                providesAllowance: Boolean(providerProfile(connection.providerId).providesAllowance),
                variants: providerProfile(connection.providerId).modelVariants ?? [],
                models: models.map((model) => ({
                  value: model.id,
                  label: model.toolUseUnavailableReason ? `${model.name} (No tool use)` : model.name,
                  ...(model.reasoning ? { reasoning: model.reasoning } : {}),
                })),
              };
            })}
            placeholder={loadingModels ? "Loading models…" : "Select model"}
            searchPlaceholder="Search models…"
            disabled={loadingModels || !providerAvailable || running}
            allowance={providerAllowance}
            reasoningEffort={reasoningEffort}
            onAllowance={onProviderAllowance}
            onChange={onModel}
            onReasoningEffort={onReasoningEffort}
          />
          <ContextGauge
            report={contextReport}
            extraTokens={pendingContextTokens}
            compacting={compactingContext}
            onCompact={onCompact}
          />
        </div>
        <ToolSurfaceControl
          surface={toolSurface}
          activeToolNames={activeToolNames}
          availableToolNames={availableToolNames}
          disabled={running || !selectedModel}
          onChange={onToolSurface}
        />
        <details
          ref={executionMode}
          className={unsafe ? "execution-mode unsafe" : "execution-mode"}
          hidden={platform === "win32"}
        >
          <summary>
            {unsafe ? <span className="execution-dot" aria-hidden="true" /> : <Shield />}
            {unsafe
              ? "Unsafe · this thread"
              : `Restricted${sandboxAccess.length ? ` · ${sandboxAccess.length}` : ""}`}
          </summary>
          <div className="execution-details">
            <strong>{unsafe ? "Unrestricted host execution" : restrictedDetail}</strong>
            <p>
              {unsafe
                ? "Shell commands run as your user and can access host files, network, and inherited environment. File tools remain workspace-only."
                : <>Shell commands can write in this workspace, use private temporary files, and {sandboxNetworkEnabled ? "use the network" : "cannot use the network"}.<br />Other host files and workspace Git metadata remain protected.</>}
            </p>
            {!unsafe && platform !== "win32" ? (
              <>
              <div className="sandbox-network-access">
                <div className="sandbox-access-heading">
                  <span>Network access</span>
                  <small>Restricted commands</small>
                </div>
                <div className="sandbox-location-options" aria-label="Network access">
                  <button
                    type="button"
                    className={sandboxNetworkEnabled ? "selected" : ""}
                    disabled={running}
                    onClick={() => onSandboxNetworkEnabled(true)}
                  >Allow</button>
                  <button
                    type="button"
                    className={!sandboxNetworkEnabled ? "selected" : ""}
                    disabled={running}
                    onClick={() => onSandboxNetworkEnabled(false)}
                  >Deny</button>
                </div>
              </div>
              <div className="sandbox-access">
                <div className="sandbox-access-heading">
                  <span>Additional locations</span>
                  <small>Remain sandboxed</small>
                </div>
                {sandboxAccess.length ? (
                  <div className="sandbox-location-list">
                    {sandboxAccess.map((location) => (
                      <div className="sandbox-location" key={location.id}>
                        <span className="sandbox-location-icon" aria-hidden="true">⌁</span>
                        <span className="sandbox-location-copy">
                          <code title={location.path}>{location.path}</code>
                          <small>
                            {location.writable ? "Read & write" : "Read only"}
                            {` · ${sandboxScopeLabel(location.scope)}`}
                          </small>
                        </span>
                        <span className="sandbox-location-actions-inline">
                          <button
                            type="button"
                            className="sandbox-location-edit"
                            aria-label={`Edit ${location.path}`}
                            title="Edit location"
                            disabled={running}
                            onClick={() => editSandboxLocation(location)}
                          >
                            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <path d="m3 11.5-.5 2 2-.5 7.7-7.7-1.5-1.5zM9.7 4.8l1.5 1.5" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="sandbox-location-remove"
                            aria-label={`Remove ${location.path}`}
                            title="Remove location"
                            disabled={running}
                            onClick={() => onRemoveSandboxAccess(location.id)}
                          >×</button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <small className="sandbox-access-empty">No additional folders allowed.</small>}

                {addingSandboxLocation ? (
                  <div className="sandbox-location-form">
                    <label>
                      Folder
                      {editingSandboxLocation ? (
                        <code className="sandbox-location-fixed" title={sandboxPath}>{sandboxPath}</code>
                      ) : (
                        <button
                          type="button"
                          className="sandbox-location-picker"
                          autoFocus
                          title={sandboxPath || undefined}
                          onClick={() => void chooseSandboxLocation()}
                        >
                          <span>{sandboxPath || "Choose folder…"}</span>
                          <span aria-hidden="true">Choose</span>
                        </button>
                      )}
                    </label>
                    <div className="sandbox-location-options" aria-label="Folder access">
                      <button
                        type="button"
                        className={!sandboxWritable ? "selected" : ""}
                        onClick={() => setSandboxWritable(false)}
                      >Read only</button>
                      <button
                        type="button"
                        className={sandboxWritable ? "selected" : ""}
                        onClick={() => setSandboxWritable(true)}
                      >Read & write</button>
                    </div>
                    <div className="sandbox-location-options sandbox-location-scope" aria-label="Permission duration">
                      <button
                        type="button"
                        className={sandboxScope === "thread" ? "selected" : ""}
                        disabled={Boolean(editingSandboxLocation)}
                        onClick={() => setSandboxScope("thread")}
                      >This thread</button>
                      <button
                        type="button"
                        className={sandboxScope === "workspace" ? "selected" : ""}
                        disabled={Boolean(editingSandboxLocation)}
                        onClick={() => setSandboxScope("workspace")}
                      >This workspace</button>
                      <button
                        type="button"
                        className={sandboxScope === "global" ? "selected" : ""}
                        disabled={Boolean(editingSandboxLocation)}
                        onClick={() => setSandboxScope("global")}
                      >All workspaces</button>
                    </div>
                    <div className="sandbox-location-actions">
                      <button type="button" onClick={closeSandboxLocationForm}>Cancel</button>
                      <button type="button" className="primary" disabled={!sandboxPath.trim() || running} onClick={saveSandboxLocation}>
                        {editingSandboxLocation ? "Save changes" : "Add access"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="sandbox-add-location"
                    disabled={running}
                    onClick={() => {
                      setEditingSandboxLocation(null);
                      setSandboxWritable(true);
                      setSandboxScope("global");
                      setAddingSandboxLocation(true);
                    }}
                  >+ Add location</button>
                )}
              </div>
              </>
            ) : !unsafe && platform === "win32" ? (
              <small className="sandbox-access-unavailable">
                Additional sandbox folders are unavailable on Windows.
              </small>
            ) : null}
            <label className={unsafe ? "host-toggle enabled" : "host-toggle"}>
              <input
                type="checkbox"
                checked={unsafe}
                onChange={(event) => onUnsafe(event.target.checked)}
                disabled={running}
              />
              {unsafe ? "Return to restricted" : "Allow unrestricted shell commands"}
            </label>
          </div>
        </details>
        {running && task.trim() ? (
          <span className="run-message-actions">
            <small>↵ Steer</small>
            {!queuedMessage ? (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  title={platform === "darwin"
                    ? "Queue after the current response (Option+Enter)"
                    : "Queue after the current response (Alt+Enter)"}
                  onClick={onQueue}
                >{platform === "darwin" ? "⌥↵ Queue" : "Alt+Enter Queue"}</button>
              </>
            ) : null}
          </span>
        ) : null}
        <button
          className={running ? "send-button stop" : "send-button"}
          type={running ? "button" : "submit"}
          onClick={running ? onStop : undefined}
          aria-label={running ? "Stop run" : "Send task"}
          aria-disabled={!running && Boolean(blocker)}
          title={running ? "Stop run" : blocker ?? "Send task"}
        >
          <span className="send-button-orb" aria-hidden="true">
            <ThinkingOrb motion={orbMotion} speed={1.7} />
          </span>
          <span className="send-button-symbol send-button-send-symbol" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path d="M10 15V5m0 0L6 9m4-4 4 4" />
            </svg>
          </span>
          <span className="send-button-symbol send-button-stop-symbol" aria-hidden="true" />
        </button>
      </div>
      {providerWait ? <div className="provider-wait" role="status">{providerWait} · waiting for the next slot</div> : null}
      {error ? <div className="composer-error" role="alert">{error}</div> : null}
    </form>
  );
}

function sandboxScopeLabel(scope: SandboxAccessGrant["scope"]): string {
  if (scope === "thread") return "This thread";
  if (scope === "workspace") return "This workspace";
  return "All workspaces";
}

function ToolSurfaceControl({
  surface,
  activeToolNames,
  availableToolNames,
  disabled,
  onChange,
}: {
  surface: ModelToolSurface;
  activeToolNames: string[];
  availableToolNames: string[];
  disabled: boolean;
  onChange(surface: ModelToolSurface): void;
}): JSX.Element {
  const details = useRef<HTMLDetailsElement>(null);
  const choices = customToolChoices().filter((name) => availableToolNames.includes(name));

  useEffect(() => {
    function close(event: PointerEvent): void {
      if (details.current?.open && event.target instanceof Node && !details.current.contains(event.target)) {
        details.current.open = false;
      }
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function toggle(name: string, enabled: boolean): void {
    const optionalTools = enabled
      ? [...surface.optionalTools, name]
      : surface.optionalTools.filter((tool) => tool !== name);
    onChange({ mode: surface.mode, optionalTools });
  }

  return (
    <details ref={details} className="tool-surface-control">
      <summary title={`Active tools: ${activeToolNames.join(", ")}`}>
        Tools
        <span>{` · ${activeToolNames.length}`}</span>
      </summary>
      <div className="tool-surface-details">
        <strong>Model tool surface</strong>
        <p>Saved for this model. Explicit thread actions may add a tool temporarily.</p>
        <div className="tool-surface-modes">
          <button
            type="button"
            className={surface.mode === "custom" ? "selected" : ""}
            disabled={disabled}
            onClick={() => onChange({ mode: "custom", optionalTools: surface.optionalTools })}
          >Custom</button>
          <button
            type="button"
            className={surface.mode === "expanded" ? "selected" : ""}
            disabled={disabled}
            onClick={() => onChange({ mode: "expanded", optionalTools: surface.optionalTools })}
          >Expanded</button>
        </div>
        {surface.mode === "custom" ? (
          <div className="tool-surface-choices">
            <small>Choose the capabilities this model can use. Plan remains available.</small>
            {surface.optionalTools.length > 2 ? (
              <small className="tool-surface-warning">
                Smaller models usually work best with fewer active capabilities.
              </small>
            ) : null}
            {choices.map((name) => {
              const checked = surface.optionalTools.includes(name);
              return (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => toggle(name, event.target.checked)}
                  />
                  {toolLabel(name)}
                </label>
              );
            })}
          </div>
        ) : <small>All configured high-level tools are active.</small>}
        <div className="tool-surface-active">
          <small>Active now</small>
          <span>{activeToolNames.map(toolLabel).join(", ")}</span>
        </div>
      </div>
    </details>
  );
}

function toolLabel(name: string): string {
  if (name === "run_command") return "Run command";
  if (name === "read_file") return "Read file";
  if (name === "search_files") return "Search files";
  if (name === "edit_file") return "Edit file";
  if (name === "write_file") return "Write file";
  if (name === "update_plan") return "Plan";
  if (name === "web_search") return "Web search";
  if (name === "web_fetch") return "Web fetch";
  if (name === "use_skill") return "Skills";
  if (name === "mcp") return "MCP";
  if (name === "delegate_task") return "Subagents";
  return name;
}

function MenuButton({ label, disabled, onClick }: {
  label: string;
  disabled?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        onClick();
        event.currentTarget.closest("details")?.removeAttribute("open");
      }}
    >{label}</button>
  );
}

function Shield(): JSX.Element {
  return (
    <svg className="execution-shield" viewBox="0 0 16 18" aria-hidden="true">
      <path d="M8 1 14 3.4v4.3c0 3.9-2.5 7.1-6 8.3-3.5-1.2-6-4.4-6-8.3V3.4L8 1Z" />
    </svg>
  );
}

type ComposerProps = {
  task: string;
  taskInput: RefObject<HTMLTextAreaElement>;
  executionMode: RefObject<HTMLDetailsElement>;
  composerAdd: RefObject<HTMLDetailsElement>;
  dragging: boolean;
  running: boolean;
  providerWait: string | null;
  pendingAttachmentCount: number;
  models: ProviderCatalog[];
  selectedProviderConnectionId: string;
  selectedModel: string;
  reasoningEffort: ReasoningEffort | "";
  providerAllowance: ProviderAllowance | null | undefined;
  toolSurface: ModelToolSurface;
  activeToolNames: string[];
  availableToolNames: string[];
  loadingModels: boolean;
  providerAvailable: boolean;
  contextReport: ContextReport | null;
  pendingContextTokens: number;
  compactingContext: boolean;
  unsafe: boolean;
  restrictedDetail: string;
  sandboxAccess: SandboxAccessGrant[];
  sandboxNetworkEnabled: boolean;
  orbMotion: OrbMotion;
  blocker: string | null;
  error: string | null;
  platform: string;
  queuedMessage: string | null;
  onTask(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onDragging(value: boolean): void;
  onDrop(event: ReactDragEvent<HTMLFormElement>): void;
  onPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onPastePlain(): void;
  onPasteMarkdown(): void;
  onChooseAttachments(): void;
  onModel(providerConnectionId: string, value: string): void;
  onReasoningEffort(value: ReasoningEffort | ""): void;
  onProviderAllowance(): void;
  onToolSurface(surface: ModelToolSurface): void;
  onCompact(): void;
  onUnsafe(value: boolean): void;
  onChooseSandboxLocation(): Promise<string | null>;
  onAddSandboxAccess(input: SandboxAccessInput): void;
  onRemoveSandboxAccess(grantId: string): void;
  onSandboxNetworkEnabled(enabled: boolean): void;
  onStop(): void;
  onQueue(): void;
  onCancelQueued(): void;
  onSlashCommand(): void;
};
