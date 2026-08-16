import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  RefObject,
} from "react";
import type { ProviderCatalog } from "../../../../providers/provider.js";
import { providerProfile } from "../../../../providers/profiles.js";
import type { ContextReport } from "../../../../context/report.js";
import { ThinkingOrb, type OrbMotion } from "../../components/thinking-orb.js";
import { ContextGauge } from "./context-gauge.js";
import { ModelPicker } from "./model-picker.js";
import { providerVisual } from "./provider-mark.js";
import { compactToolChoices, type ModelToolSurface } from "../../../../capabilities/surface.js";

export function Composer({
  task,
  taskInput,
  executionMode,
  composerAdd,
  dragging,
  running,
  pendingAttachmentCount,
  models,
  selectedProviderConnectionId,
  selectedModel,
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
  orbMotion,
  blocker,
  error,
  platform,
  onTask,
  onSubmit,
  onDragging,
  onDrop,
  onPaste,
  onPastePlain,
  onPasteMarkdown,
  onChooseAttachments,
  onModel,
  onToolSurface,
  onCompact,
  onUnsafe,
  onStop,
  onSlashCommand,
}: ComposerProps): JSX.Element {
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
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="Describe the coding task…"
        rows={1}
      />

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
                variants: providerProfile(connection.providerId).modelVariants ?? [],
                models: models.map((model) => ({ value: model.id, label: model.name })),
              };
            })}
            placeholder={loadingModels ? "Loading models…" : "Select model"}
            searchPlaceholder="Search models…"
            disabled={loadingModels || !providerAvailable || running}
            onChange={onModel}
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
        <details ref={executionMode} className={unsafe ? "execution-mode unsafe" : "execution-mode"}>
          <summary>
            {unsafe ? <span className="execution-dot" aria-hidden="true" /> : <Shield />}
            {unsafe ? "Unsafe · this thread" : "Restricted"}
          </summary>
          <div className="execution-details">
            <button
              className="execution-details-close"
              type="button"
              aria-label="Close execution settings"
              title="Close"
              onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
            >×</button>
            <strong>{unsafe ? "Unrestricted host execution" : restrictedDetail}</strong>
            <p>
              {unsafe
                ? "Shell commands run as your user and can access host files, network, and inherited environment. File tools remain workspace-only."
                : <>Shell commands can write in this workspace and use private temporary files.<br />Personal host files, network access, and Git metadata are blocked.</>}
            </p>
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
        {running && task.trim() ? <small className="steer-hint">Enter to steer</small> : null}
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
          <span className="send-button-symbol send-button-send-symbol" aria-hidden="true">↑</span>
          <span className="send-button-symbol send-button-stop-symbol" aria-hidden="true" />
        </button>
      </div>
      {error ? <div className="composer-error" role="alert">{error}</div> : null}
    </form>
  );
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
  const labels = activeSurfaceLabels(activeToolNames);
  const choices = compactToolChoices().filter((name) => availableToolNames.includes(name));

  function toggle(name: string, enabled: boolean): void {
    const optionalTools = enabled
      ? [...surface.optionalTools, name]
      : surface.optionalTools.filter((tool) => tool !== name);
    if (optionalTools.length <= 2) onChange({ mode: surface.mode, optionalTools });
  }

  return (
    <details className="tool-surface-control">
      <summary title={`Active tools: ${activeToolNames.join(", ")}`}>
        {surface.mode === "compact" ? "Compact" : "Expanded"}
        <span>{labels.length ? ` · ${labels.join(" · ")}` : " · Core only"}</span>
      </summary>
      <div className="tool-surface-details">
        <strong>Model tool surface</strong>
        <p>Saved for this model. Explicit thread actions may add a tool temporarily.</p>
        <div className="tool-surface-modes">
          <button
            type="button"
            className={surface.mode === "compact" ? "selected" : ""}
            disabled={disabled}
            onClick={() => onChange({ mode: "compact", optionalTools: surface.optionalTools })}
          >Compact</button>
          <button
            type="button"
            className={surface.mode === "expanded" ? "selected" : ""}
            disabled={disabled}
            onClick={() => onChange({ mode: "expanded", optionalTools: surface.optionalTools })}
          >Expanded</button>
        </div>
        {surface.mode === "compact" ? (
          <div className="tool-surface-choices">
            <small>Choose up to two optional capabilities. Plan remains available.</small>
            {choices.map((name) => {
              const checked = surface.optionalTools.includes(name);
              return (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || (!checked && surface.optionalTools.length >= 2)}
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

function activeSurfaceLabels(names: string[]): string[] {
  const labels = new Set<string>();
  if (names.includes("update_plan")) labels.add("Plan");
  if (names.includes("web_search") || names.includes("web_fetch")) labels.add("Web");
  if (names.includes("use_skill")) labels.add("Skills");
  if (names.includes("mcp")) labels.add("MCP");
  if (names.includes("delegate_task")) labels.add("Subagents");
  return [...labels];
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
  pendingAttachmentCount: number;
  models: ProviderCatalog[];
  selectedProviderConnectionId: string;
  selectedModel: string;
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
  orbMotion: OrbMotion;
  blocker: string | null;
  error: string | null;
  platform: string;
  onTask(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onDragging(value: boolean): void;
  onDrop(event: ReactDragEvent<HTMLFormElement>): void;
  onPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onPastePlain(): void;
  onPasteMarkdown(): void;
  onChooseAttachments(): void;
  onModel(providerConnectionId: string, value: string): void;
  onToolSurface(surface: ModelToolSurface): void;
  onCompact(): void;
  onUnsafe(value: boolean): void;
  onStop(): void;
  onSlashCommand(): void;
};
