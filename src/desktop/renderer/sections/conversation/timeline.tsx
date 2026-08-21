import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AttachmentRef } from "../../../../attachments/types.js";
import type { CommandApprovalDecision } from "../../../../protocol.js";
import { MAX_KEPT_ASIDE_MESSAGES, type SandboxAccessInput } from "../../../api.js";
import {
  FileChangeSummaryCard,
  FileToolPreview,
  isFileMutationTool,
  type FileChangeSummary,
} from "./file-tool-preview.js";
import { ExecutionToolPreview, isExecutionPreviewTool } from "./execution-tool-preview.js";
import { CopyIcon, MarkdownContent } from "./markdown.js";
import {
  toolGeneratingLabel,
  toolStatus,
  type KeepableTimelineItem,
  type SaveableTimelineItem,
  type TimelineItem,
} from "./timeline-state.js";

type ModelCallTimelineItem = Extract<TimelineItem, { kind: "assistant" }>;
type ActivityDisclosureCommand = { id: number; open: boolean };

export function TimelineEntry({
  item,
  previousModel,
  selectedId,
  turnRunning = false,
  activeToolPreviewId = null,
  activityDisclosureCommand,
  fileChangeSummary,
  reasoningModelCalls,
  onSelect,
  onOpenFile,
  onReviewChanges,
  onEditUser,
  onResolveApproval,
  onChooseSandboxFolder,
  onGrantSandboxAccess,
  savedId,
  onToggleSaved,
  keptAside = false,
  canKeepAside = true,
  onToggleKeptAside,
  onToggleAttachmentContext,
  onRestore,
  onRegenerate,
  onFork,
}: {
  item: TimelineItem;
  previousModel?: string | undefined;
  selectedId: string | null;
  turnRunning?: boolean;
  activeToolPreviewId?: string | null;
  activityDisclosureCommand?: ActivityDisclosureCommand | null;
  fileChangeSummary?: FileChangeSummary | undefined;
  reasoningModelCalls?: ReadonlyMap<string, ModelCallTimelineItem>;
  onSelect: (id: string) => void;
  onOpenFile?: (path: string) => void;
  onReviewChanges?: () => void;
  onEditUser?: (text: string) => void;
  onResolveApproval?: (id: string, decision: CommandApprovalDecision) => void;
  onChooseSandboxFolder?: () => Promise<string | null>;
  onGrantSandboxAccess?: (id: string, inputs: SandboxAccessInput[]) => Promise<void>;
  savedId?: string | undefined;
  onToggleSaved?: (item: SaveableTimelineItem, savedId?: string) => void;
  keptAside?: boolean;
  canKeepAside?: boolean;
  onToggleKeptAside?: (item: KeepableTimelineItem) => void;
  onToggleAttachmentContext?: (
    item: Extract<TimelineItem, { kind: "user" }>,
    attachment: AttachmentRef,
  ) => void;
  onRestore?: (sequence: number) => void;
  onRegenerate?: (sequence: number) => void;
  onFork?: (sequence: number) => void;
}): JSX.Element {
  if (item.kind === "activity-group") {
    return (
      <ActivityGroup
        item={item}
        selectedId={selectedId}
        turnRunning={turnRunning}
        activeToolPreviewId={activeToolPreviewId}
        {...(reasoningModelCalls ? { reasoningModelCalls } : {})}
        onSelect={onSelect}
        {...(onOpenFile ? { onOpenFile } : {})}
        {...(onResolveApproval ? { onResolveApproval } : {})}
        {...(onChooseSandboxFolder ? { onChooseSandboxFolder } : {})}
        {...(onGrantSandboxAccess ? { onGrantSandboxAccess } : {})}
      />
    );
  }

  if (item.kind === "reasoning") {
    const modelCall = reasoningModelCalls?.get(item.id);
    return (
      <ReasoningEntry
        item={item}
        selected={Boolean(modelCall && modelCall.id === selectedId)}
        {...(activityDisclosureCommand !== undefined ? { disclosureCommand: activityDisclosureCommand } : {})}
        {...(modelCall ? {
          durationMs: modelCall.durationMs,
          onInspect: () => onSelect(modelCall.id),
        } : {})}
      />
    );
  }

  if (item.kind === "context") return <ContextEntry item={item} />;

  if (item.kind === "approval") {
    return (
      <ApprovalEntry
        item={item}
        {...(onResolveApproval ? { onResolve: onResolveApproval } : {})}
        {...(onChooseSandboxFolder ? { onChooseSandboxFolder } : {})}
        {...(onGrantSandboxAccess ? { onGrantSandboxAccess } : {})}
      />
    );
  }

  if (item.kind === "retry") {
    return (
      <div className="activity-row retry-row" title={item.text}>
        <span aria-hidden="true">↻</span>
        <span>Retry {item.attempt}/{item.maxRetries}</span>
      </div>
    );
  }

  if (item.kind === "image-understanding") {
    return (
      <button
        className={item.id === selectedId ? "activity-row image-understanding-row selected" : "activity-row image-understanding-row"}
        type="button"
        onClick={() => onSelect(item.id)}
      >◉ {item.text}</button>
    );
  }

  if (item.kind === "tool-preparing") {
    return <ToolPreparingEntry item={item} />;
  }

  if (item.kind === "tool") {
    const status = toolStatus(item);
    const title = item.presentation?.title ?? mcpToolName(item.call) ?? item.call.name;
    const subtitle = item.presentation?.subtitle;
    if (isFileMutationTool(item.call.name)) {
      return (
        <FileToolPreview
          item={item}
          selected={item.id === selectedId}
          turnRunning={turnRunning}
          autoExpanded={item.id === activeToolPreviewId}
          statusClass={status.className}
          duration={item.durationMs ? formatDuration(item.durationMs) : undefined}
          {...(activityDisclosureCommand !== undefined ? { disclosureCommand: activityDisclosureCommand } : {})}
          onSelect={() => onSelect(item.id)}
          {...(onOpenFile ? { onOpenFile } : {})}
        />
      );
    }
    if (isExecutionPreviewTool(item.call.name)) {
      return (
        <ExecutionToolPreview
          item={item}
          selected={item.id === selectedId}
          turnRunning={turnRunning}
          autoExpanded={item.id === activeToolPreviewId}
          statusClass={status.className}
          duration={item.durationMs ? formatDuration(item.durationMs) : undefined}
          {...(activityDisclosureCommand !== undefined ? { disclosureCommand: activityDisclosureCommand } : {})}
          onSelect={() => onSelect(item.id)}
        />
      );
    }
    const row = (
      <button
        className={item.id === selectedId ? `tool-row ${status.className} selected` : `tool-row ${status.className}`}
        type="button"
        onClick={() => onSelect(item.id)}
      >
        <ToolIcon name={item.call.name} />
        <span className="tool-row-copy">
          <span className="tool-row-title">
            <strong>{title}</strong>
            {item.call.inputRepair ? (
              <span className="tool-healed" title={item.call.inputRepair}>healed</span>
            ) : null}
          </span>
          <span className="tool-row-status">{subtitle ? `${subtitle} · ${status.label}` : status.label}</span>
        </span>
        {item.durationMs ? <time>{formatDuration(item.durationMs)}</time> : null}
      </button>
    );
    return row;
  }

  if (item.kind === "assistant") {
    if (!item.text && item.intermediate) return <></>;
    return (
      <>
        {previousModel && item.model && previousModel !== item.model ? (
          <div className="model-change-marker">Model changed · {item.model}</div>
        ) : null}
        <article
          className={item.intermediate ? "message assistant intermediate" : "message assistant"}
          {...(item.entryId ? { "data-entry-id": item.entryId } : {})}
        >
          <div className={item.streaming ? "markdown-content streaming" : "markdown-content"}>
            {item.streaming ? (
              <>{streamingText(item.text)}<span className="streaming-cursor" aria-hidden="true" /></>
            ) : (
              <MarkdownContent text={item.text} {...(item.sources ? { sources: item.sources } : {})} />
            )}
          </div>
          {!item.streaming && !item.intermediate && fileChangeSummary ? (
            <FileChangeSummaryCard
              summary={fileChangeSummary}
              {...(onOpenFile ? { onOpenFile } : {})}
              {...(onReviewChanges ? { onReview: onReviewChanges } : {})}
            />
          ) : null}
          {item.finishReason === "incomplete" ? (
            <div className="interrupted-response" role="note">
              <span>The provider closed the response early.</span>
              {onRegenerate && item.sequence !== undefined ? (
                <button type="button" onClick={() => onRegenerate(item.sequence!)}>
                  Regenerate response
                </button>
              ) : null}
            </div>
          ) : null}
          {!item.streaming && !item.intermediate ? (
            <MessageFooter
              text={item.text}
              metadata={modelMetadata(item)}
              saved={Boolean(savedId)}
              keptAside={keptAside}
              canKeepAside={canKeepAside}
              {...(onFork && item.sequence !== undefined
                ? { onFork: () => onFork(item.sequence!) }
                : {})}
              {...(onToggleSaved ? { onSave: () => onToggleSaved(item, savedId) } : {})}
              {...(onToggleKeptAside && item.entryId ? { onToggleKeptAside: () => onToggleKeptAside(item) } : {})}
            />
          ) : null}
        </article>
      </>
    );
  }

  if (item.kind === "user") {
    return (
      <UserMessage
        item={item}
        {...(onEditUser ? { onEdit: onEditUser } : {})}
        {...(onFork ? { onFork } : {})}
        {...(onToggleAttachmentContext ? { onToggleAttachmentContext } : {})}
      />
    );
  }

  return (
    <article className={`message ${item.kind}`}>
      {item.kind === "error" ? <span className="message-label">Run failed</span> : null}
      <p>{item.text}</p>
      {item.kind === "error" && item.restoreSequence !== undefined && onRestore ? (
        <button className="restore-thread" type="button" onClick={() => onRestore(item.restoreSequence!)}>
          Restore previous context
        </button>
      ) : null}
    </article>
  );
}

export function ActivePlan({ items }: { items: TimelineItem[] }): JSX.Element | null {
  const plan = activePlan(items);
  if (!plan) return null;
  return (
    <div className="active-plan">
      <div className="active-plan-heading">
        <ToolIcon name="update_plan" />
        <strong>{plan.items ? "Plan" : "Updating plan…"}</strong>
        {plan.updating ? <span className="activity-spinner" aria-hidden="true" /> : null}
      </div>
      {plan.items ? (
        <ol className="active-plan-steps">
          {plan.items.map((item, index) => (
            <li className={`active-plan-step ${item.status}`} key={`${index}:${item.step}`}>
              <span className="active-plan-marker" aria-hidden="true" />
              <span>{item.step}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

type PlanItem = {
  step: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
};

type ActivePlanState = {
  items: PlanItem[] | null;
  updating: boolean;
};

function activePlan(items: TimelineItem[]): ActivePlanState | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "user") return null;
    if (item.kind !== "tool" || item.call.name !== "update_plan") continue;
    if (item.phase === "running") {
      return { items: planItems(item.call.input), updating: true };
    }
    if (item.isError) continue;
    const plan = planItems(item.call.input);
    if (!plan) continue;
    return { items: plan, updating: false };
  }
  return null;
}

function planItems(input: unknown): PlanItem[] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rawItems = (input as Record<string, unknown>).items;
  if (!Array.isArray(rawItems) || !rawItems.length) return null;
  const items: PlanItem[] = [];
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return null;
    const entry = rawItem as Record<string, unknown>;
    if (typeof entry.step !== "string" ||
      (entry.status !== "pending" && entry.status !== "in_progress" &&
        entry.status !== "completed" && entry.status !== "blocked")) return null;
    items.push({ step: entry.step, status: entry.status });
  }
  return items;
}

function mcpToolName(call: { name: string; input: unknown }): string | undefined {
  if (call.name !== "mcp" || !call.input || typeof call.input !== "object" || Array.isArray(call.input)) return undefined;
  const input = call.input as Record<string, unknown>;
  return input.action === "call" && typeof input.tool === "string" ? input.tool : undefined;
}

function ActivityGroup({
  item,
  selectedId,
  turnRunning,
  activeToolPreviewId,
  reasoningModelCalls,
  onSelect,
  onOpenFile,
  onResolveApproval,
  onChooseSandboxFolder,
  onGrantSandboxAccess,
}: {
  item: Extract<TimelineItem, { kind: "activity-group" }>;
  selectedId: string | null;
  turnRunning: boolean;
  activeToolPreviewId: string | null;
  reasoningModelCalls?: ReadonlyMap<string, ModelCallTimelineItem>;
  onSelect: (id: string) => void;
  onOpenFile?: (path: string) => void;
  onResolveApproval?: (id: string, decision: CommandApprovalDecision) => void;
  onChooseSandboxFolder?: () => Promise<string | null>;
  onGrantSandboxAccess?: (id: string, inputs: SandboxAccessInput[]) => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [disclosureCommand, setDisclosureCommand] = useState<ActivityDisclosureCommand | null>(null);
  const items = item.items.filter(isVisibleActivityItem);

  if (!items.length) return <></>;

  return (
    <details
      className="activity-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="activity-disclosure-summary">
        <span className="activity-summary-copy">
          <strong>Work details</strong>
          <small>{activityGroupMetadata(items)}</small>
        </span>
      </summary>
      {open ? (
        <>
          {!turnRunning ? (
            <div className="activity-group-actions">
              <button
                type="button"
                onClick={() => setDisclosureCommand((current) => ({ id: (current?.id ?? 0) + 1, open: true }))}
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={() => setDisclosureCommand((current) => ({ id: (current?.id ?? 0) + 1, open: false }))}
              >
                Collapse all
              </button>
            </div>
          ) : null}
          <div className="execution-tree activity-group-body">
            {items.map((child) => {
              const childStatus = activityItemStatus(child);
              return (
                <div className={`execution-tree-item ${childStatus} activity-group-item`} key={child.id}>
                  <span className="execution-tree-marker" aria-hidden="true" />
                  <div className="execution-tree-content">
                    <TimelineEntry
                      item={child}
                      selectedId={selectedId}
                      turnRunning={turnRunning}
                      activeToolPreviewId={activeToolPreviewId}
                      activityDisclosureCommand={disclosureCommand}
                      {...(reasoningModelCalls ? { reasoningModelCalls } : {})}
                      onSelect={onSelect}
                      {...(onOpenFile ? { onOpenFile } : {})}
                      {...(onResolveApproval ? { onResolveApproval } : {})}
                      {...(onChooseSandboxFolder ? { onChooseSandboxFolder } : {})}
                      {...(onGrantSandboxAccess ? { onGrantSandboxAccess } : {})}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </details>
  );
}

function isVisibleActivityItem(item: TimelineItem): boolean {
  return item.kind !== "assistant" || Boolean(item.text);
}

type ActivityStatus = "running" | "completed" | "warning" | "failed";

function activityItemStatus(item: TimelineItem): ActivityStatus {
  if (item.kind === "reasoning" && item.streaming) return "running";
  if (item.kind === "tool-preparing" || (item.kind === "tool" && item.phase === "running")) return "running";
  if (item.kind === "error" || (item.kind === "tool" && item.isError)) return "failed";
  if (item.kind === "retry" || (item.kind === "tool" && typeof item.exitCode === "number" && item.exitCode !== 0)) {
    return "warning";
  }
  return "completed";
}

function activityGroupMetadata(items: TimelineItem[]): string {
  const toolCount = items.filter((item) => item.kind === "tool").length;
  const parts = [`${items.length} step${items.length === 1 ? "" : "s"}`];
  if (toolCount) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function ApprovalEntry({
  item,
  onResolve,
  onChooseSandboxFolder,
  onGrantSandboxAccess,
}: {
  item: Extract<TimelineItem, { kind: "approval" }>;
  onResolve?: (id: string, decision: CommandApprovalDecision) => void;
  onChooseSandboxFolder?: () => Promise<string | null>;
  onGrantSandboxAccess?: (id: string, inputs: SandboxAccessInput[]) => Promise<void>;
}): JSX.Element {
  const [folders, setFolders] = useState(item.suggestedPaths ?? []);
  const [writable, setWritable] = useState(true);
  const [scope, setScope] = useState<SandboxAccessInput["scope"]>("thread");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [granting, setGranting] = useState(false);

  if (item.decision) {
    const label = item.decision === "deny"
      ? "Extra access denied"
      : item.decision === "once"
        ? "Extra access allowed once"
        : item.decision === "response"
          ? "Unrestricted access allowed for this response"
        : item.decision === "sandbox"
          ? "Folder added; command retried in the sandbox"
          : "Extra access allowed for this thread";
    return <div className={`approval-result ${item.decision}`}>{label}</div>;
  }

  const networkRequest = item.reason.includes("requests network access");
  const scopeLabel = scope === "thread"
    ? "for this thread"
    : scope === "workspace"
      ? "for this workspace"
      : "in all workspaces";
  const explanation = networkRequest
    ? "Restricted mode blocks network access. You can allow this command to run with your normal user access."
    : folders.length
      ? `Allow ${writable ? "read and write" : "read"} access ${scopeLabel} and retry inside the sandbox.`
      : "Snaffle could not identify the required folder. Choose one to retry inside the sandbox, or use Allow once to run this command outside it.";

  async function chooseFolder(add = false): Promise<void> {
    const selected = await onChooseSandboxFolder?.();
    if (!selected) return;
    setFolders((current) => add ? [...new Set([...current, selected])] : [selected]);
  }

  async function grantFolders(): Promise<void> {
    if (!folders.length || !onGrantSandboxAccess) return;
    setGranting(true);
    try {
      await onGrantSandboxAccess(item.id, folders.map((folder) => ({ path: folder, writable, scope })));
    } finally {
      setGranting(false);
    }
  }

  const canGrantFolders = !networkRequest && Boolean(onChooseSandboxFolder && onGrantSandboxAccess);

  return (
    <section className="approval-card">
      <strong>Command needs extra access</strong>
      <code>{item.command}</code>
      <p>{explanation}</p>
      {folders.length ? (
        <div className="approval-paths">
          {folders.map((folder) => <code key={folder} title={folder}>{folder}</code>)}
        </div>
      ) : null}
      <div className="approval-actions">
        {folders.length && canGrantFolders ? (
          <button type="button" className="primary" disabled={granting} onClick={() => void grantFolders()}>
            {granting ? "Adding…" : "Add to sandbox"}
          </button>
        ) : null}
        {canGrantFolders && !folders.length ? (
          <button type="button" onClick={() => void chooseFolder()}>Choose folder</button>
        ) : null}
        {!networkRequest ? (
          <button type="button" onClick={() => onResolve?.(item.id, "once")}>Allow once</button>
        ) : null}
        {!networkRequest ? (
          <button type="button" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>Options</button>
        ) : null}
        <button type="button" onClick={() => onResolve?.(item.id, "deny")}>Deny</button>
        {networkRequest ? (
          <>
            <button type="button" onClick={() => onResolve?.(item.id, "once")}>Allow once</button>
            <button type="button" onClick={() => onResolve?.(item.id, "thread")}>Unrestricted for this thread</button>
          </>
        ) : null}
      </div>
      {optionsOpen ? (
        <div className="approval-options">
          {folders.length ? (
            <>
              <div className="approval-folder-options">
                <button type="button" className={!writable ? "selected" : ""} onClick={() => setWritable(false)}>Read only</button>
                <button type="button" className={writable ? "selected" : ""} onClick={() => setWritable(true)}>Read & write</button>
              </div>
              <div className="approval-folder-options three">
                <button type="button" className={scope === "thread" ? "selected" : ""} onClick={() => setScope("thread")}>This thread</button>
                <button type="button" className={scope === "workspace" ? "selected" : ""} onClick={() => setScope("workspace")}>This workspace</button>
                <button type="button" className={scope === "global" ? "selected" : ""} onClick={() => setScope("global")}>All workspaces</button>
              </div>
              <button type="button" className="approval-add-folder" onClick={() => void chooseFolder(true)}>Add another folder</button>
            </>
          ) : null}
          <div className="approval-host-access">
            <span>Disable sandbox</span>
            <button type="button" onClick={() => onResolve?.(item.id, "response")}>Unrestricted for this response</button>
            <button type="button" onClick={() => onResolve?.(item.id, "thread")}>Unrestricted for this thread</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function UserMessage({
  item,
  onEdit,
  onFork,
  onToggleAttachmentContext,
}: {
  item: Extract<TimelineItem, { kind: "user" }>;
  onEdit?: (text: string) => void;
  onFork?: (sequence: number) => void;
  onToggleAttachmentContext?: (item: Extract<TimelineItem, { kind: "user" }>, attachment: AttachmentRef) => void;
}): JSX.Element {
  const collapsible = item.text.length > 1000 || item.text.split("\n").length > 12;
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!collapsible || !body) return;
    const syncHeight = (): void => {
      const bottomPadding = Number.parseFloat(getComputedStyle(body).paddingBottom) || 0;
      body.style.setProperty("--message-expanded-height", `${body.scrollHeight + bottomPadding}px`);
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(body);
    return () => observer.disconnect();
  }, [collapsible, expanded, item.text, item.attachments?.length]);

  return (
    <article
      className="message user"
      data-timeline-id={item.id}
      {...(item.entryId ? { "data-entry-id": item.entryId } : {})}
    >
      <div
        ref={bodyRef}
        className={`message-body${collapsible ? " collapsible" : ""}${collapsible && !expanded ? " collapsed" : ""}`}
      >
        {item.text ? <p>{item.text}</p> : null}
        {item.attachments?.length ? (
          <div className="message-attachments">
            {item.attachments.map((attachment) => {
              const included = attachment.includeInContext !== false;
              return (
                <button
                  key={attachment.id}
                  className={included ? "" : "removed"}
                  type="button"
                  disabled={!onToggleAttachmentContext}
                  title={included ? "Remove from future model context" : "Add back to model context"}
                  aria-label={`${included ? "Remove" : "Restore"} ${attachment.name} ${included ? "from" : "to"} model context`}
                  onClick={() => onToggleAttachmentContext?.(item, attachment)}
                >
                  <span>{attachment.name}</span>
                  <b aria-hidden="true">{included ? "×" : "↻"}</b>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {collapsible ? (
        <button
          className="message-collapse-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
          {expanded ? "Collapse" : "Show full message"}
        </button>
      ) : null}
      <MessageFooter
        text={item.text}
        compact
        {...(onEdit ? { onEdit: () => onEdit(item.text) } : {})}
        {...(onFork ? { onFork: () => onFork(item.sequence) } : {})}
      />
    </article>
  );
}

function MessageFooter({
  text,
  metadata,
  children,
  compact = false,
  onEdit,
  onFork,
  saved = false,
  onSave,
  keptAside = false,
  canKeepAside = true,
  onToggleKeptAside,
}: {
  text: string;
  metadata?: string;
  children?: ReactNode;
  compact?: boolean;
  onEdit?: () => void;
  onFork?: () => void;
  saved?: boolean;
  onSave?: () => void;
  keptAside?: boolean;
  canKeepAside?: boolean;
  onToggleKeptAside?: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <footer className="message-footer">
      <span className="message-metadata">{metadata}</span>
      <span className={compact ? "message-actions compact" : "message-actions"}>
        {children}
        {onSave ? (
          <button
            className={saved ? "message-save saved" : "message-save"}
            type="button"
            onClick={onSave}
            title={saved ? "Remove saved message" : "Save message"}
            aria-label={saved ? "Remove saved message" : "Save message"}
          >
            <BookmarkIcon filled={saved} />
            <span className="action-label">{saved ? "Saved" : "Save"}</span>
          </button>
        ) : null}
        {onToggleKeptAside ? (
          <button
            className={keptAside ? "message-aside kept-aside" : "message-aside"}
            type="button"
            disabled={!keptAside && !canKeepAside}
            onClick={onToggleKeptAside}
            title={keptAside ? "Remove from kept aside" : canKeepAside ? "Keep aside" : `You can keep up to ${MAX_KEPT_ASIDE_MESSAGES} messages aside`}
            aria-label={keptAside ? "Remove from kept aside" : "Keep aside"}
          >
            <AsideIcon />
            <span className="action-label">{keptAside ? "Kept aside" : "Keep aside"}</span>
          </button>
        ) : null}
        {onFork ? (
          <button type="button" onClick={onFork} title="Fork from this message" aria-label="Fork from this message">
            <ForkIcon />
            <span className="action-label">Fork</span>
          </button>
        ) : null}
        <button type="button" onClick={() => void copy()} title="Copy message" aria-label="Copy message">
          <CopyIcon />
          <span className="action-label">{copied ? "Copied" : "Copy"}</span>
        </button>
        {onEdit ? (
          <button type="button" onClick={onEdit} title="Edit message" aria-label="Edit message">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m3 11.5-.5 2 2-.5 7.7-7.7-1.5-1.5zM9.7 4.8l1.5 1.5" />
            </svg>
            <span className="action-label">Edit</span>
          </button>
        ) : null}
      </span>
    </footer>
  );
}

function modelMetadata(item: Extract<TimelineItem, { kind: "assistant" }>): string {
  const tokens = item.usage?.outputTokens;
  const rate = tokens && item.durationMs ? tokens / (item.durationMs / 1000) : undefined;
  return [item.model, rate ? `${rate.toFixed(1)} tok/s` : undefined].filter(Boolean).join(" · ");
}

function ToolIcon({ name }: { name: string }): JSX.Element {
  if (name === "run_command") {
    return (
      <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
        <path d="m4 6 2 2-2 2M8 10h3" />
      </svg>
    );
  }

  if (name === "web_search" || name === "web_fetch") {
    return (
      <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M1.5 8h13M8 1.5c2 2 3 4.2 3 6.5s-1 4.5-3 6.5c-2-2-3-4.2-3-6.5s1-4.5 3-6.5" />
      </svg>
    );
  }

  if (name === "update_plan") {
    return (
      <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="m2.5 4 1 1 2-2M7 4h6M2.5 8 1 1 2-2M7 8h6M2.5 12l1 1 2-2M7 12h6" />
      </svg>
    );
  }

  if (name === "youtube_transcript") {
    return (
      <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="3" width="13" height="10" rx="3" />
        <path d="m6.5 6 4 2-4 2z" />
      </svg>
    );
  }

  if (name === "delegate_task") {
    return (
      <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="5" cy="4" r="2" />
        <circle cx="11" cy="12" r="2" />
        <path d="M5 6v2a4 4 0 0 0 4 4M7 4h2a2 2 0 0 1 2 2v4" />
      </svg>
    );
  }

  return (
    <svg className="tool-row-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" />
    </svg>
  );
}

function ReasoningEntry({
  item,
  selected,
  durationMs,
  disclosureCommand,
  onInspect,
}: {
  item: Extract<TimelineItem, { kind: "reasoning" }>;
  selected: boolean;
  durationMs?: number | undefined;
  disclosureCommand?: ActivityDisclosureCommand | null;
  onInspect?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(item.streaming);
  const [now, setNow] = useState(Date.now());
  const textRef = useRef<HTMLDivElement>(null);
  const followText = useRef(true);

  useEffect(() => setOpen(item.streaming), [item.streaming]);
  useEffect(() => {
    if (disclosureCommand) setOpen(disclosureCommand.open);
  }, [disclosureCommand]);
  useEffect(() => {
    if (!item.retryAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [item.retryAt]);
  useEffect(() => {
    if (item.streaming && open && followText.current && textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [item.text, item.streaming, open]);

  return (
    <div className={selected ? "reasoning-block selected" : "reasoning-block"}>
      <button
        className="activity-disclosure-summary"
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (onInspect) {
            if (!selected) {
              onInspect();
              setOpen(true);
            } else if (!item.streaming) {
              setOpen((current) => !current);
            }
          } else {
            setOpen((current) => !current);
          }
        }}
        title={onInspect ? "Inspect model call and toggle thinking" : "Toggle thinking"}
      >
        <span
          className={`execution-status-dot activity-summary-dot ${item.streaming ? "running" : "completed"}`}
          aria-hidden="true"
        />
        <strong>{reasoningStatus(item, now)}</strong>
        {item.text ? <span className="reasoning-chevron" aria-hidden="true" /> : null}
        {durationMs !== undefined ? (
          <time className="reasoning-duration">{formatDuration(durationMs)}</time>
        ) : null}
      </button>
      <div className={open ? "reasoning-reveal open" : "reasoning-reveal"} aria-hidden={!open}>
        <div className="reasoning-reveal-content">
          {item.text ? (
            <div
              ref={textRef}
              className="reasoning-text"
              onScroll={(event) => {
                const text = event.currentTarget;
                followText.current = text.scrollHeight - text.scrollTop - text.clientHeight < 24;
              }}
            >
              {reasoningText(item.text)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function reasoningStatus(
  item: Extract<TimelineItem, { kind: "reasoning" }>,
  now: number,
): string {
  if (item.status) return item.status;
  if (item.retryAt) {
    const seconds = Math.ceil((item.retryAt - now) / 1000);
    return seconds > 0 ? `Retrying in ${seconds}s…` : "Retrying now…";
  }
  return item.streaming ? "Thinking…" : "Thinking";
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`;
}

function streamingText(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "");
}

function reasoningText(text: string): string {
  return streamingText(text).replace(/(?:\r?\n[ \t]*)+$/, "");
}

function ContextEntry({ item }: { item: Extract<TimelineItem, { kind: "context" }> }): JSX.Element {
  const label = item.status === "applied"
    ? "Context compacted"
    : item.status === "failed"
      ? "Context preparation failed"
      : item.text ?? "Compact context prepared";
  const details = [
    item.sourceCharacters === undefined ? null : `${formatCount(item.sourceCharacters)} source characters`,
    item.summaryCharacters === undefined ? null : `${formatCount(item.summaryCharacters)} summary characters`,
    item.injectedCharacters === undefined ? null : `${formatCount(item.injectedCharacters)} characters injected`,
  ].filter(Boolean).join(" · ");
  return (
    <details className={`context-event ${item.status}`}>
      <summary><span>{label}</span>{details ? <small>{details}</small> : null}</summary>
      {item.model ? <p>Summary model: {item.model}</p> : null}
      {item.summary ? <pre>{item.summary}</pre> : null}
      {item.status === "failed" && item.text ? <p>{item.text}</p> : null}
    </details>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function ToolPreparingEntry({
  item,
}: {
  item: Extract<TimelineItem, { kind: "tool-preparing" }>;
}): JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = (): void => setElapsed(Math.floor((Date.now() - item.startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [item.startedAt]);

  const progress = item.argumentChars
    ? ` · ${item.argumentChars < 1024 ? item.argumentChars : `${(item.argumentChars / 1024).toFixed(1)}k`} chars`
    : "";
  return (
    <div className="activity-row">
      <span className="activity-spinner" aria-hidden="true" />
      <span>{toolGeneratingLabel(item.name)}{progress} · {elapsed}s</span>
    </div>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="M4 2.5h8v11l-4-2.5-4 2.5z" />
    </svg>
  );
}

function AsideIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2.5h8.5v11H3zM5.5 5.5h3.5M5.5 8h3.5" />
      <path d="M13 4.5v7" />
    </svg>
  );
}

function ForkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M4 4.5v2.25A5.25 5.25 0 0 0 9.25 12H10.5M4 6.5A5.5 5.5 0 0 1 9.5 5H10.5" />
    </svg>
  );
}
