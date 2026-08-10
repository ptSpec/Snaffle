import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AttachmentRef } from "../../../../attachments/types.js";
import type { CommandApprovalDecision } from "../../../../protocol.js";
import { CopyIcon, MarkdownContent } from "./markdown.js";
import {
  toolGeneratingLabel,
  toolStatus,
  type SaveableTimelineItem,
  type TimelineItem,
} from "./timeline-state.js";


export function TimelineEntry({
  item,
  previousModel,
  selectedId,
  onSelect,
  onEditUser,
  onResolveApproval,
  savedId,
  onToggleSaved,
  onToggleAttachmentContext,
  onRestore,
  onFork,
}: {
  item: TimelineItem;
  previousModel?: string | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEditUser?: (text: string) => void;
  onResolveApproval?: (id: string, decision: CommandApprovalDecision) => void;
  savedId?: string | undefined;
  onToggleSaved?: (item: SaveableTimelineItem, savedId?: string) => void;
  onToggleAttachmentContext?: (
    item: Extract<TimelineItem, { kind: "user" }>,
    attachment: AttachmentRef,
  ) => void;
  onRestore?: (sequence: number) => void;
  onFork?: (sequence: number) => void;
}): JSX.Element {
  if (item.kind === "activity-group") {
    return (
      <ActivityGroup
        item={item}
        selectedId={selectedId}
        onSelect={onSelect}
        {...(onResolveApproval ? { onResolveApproval } : {})}
      />
    );
  }

  if (item.kind === "reasoning") return <ReasoningEntry item={item} />;

  if (item.kind === "context") return <ContextEntry item={item} />;

  if (item.kind === "approval") {
    return (
      <ApprovalEntry
        item={item}
        {...(onResolveApproval ? { onResolve: onResolveApproval } : {})}
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

  if (item.kind === "provider-fallback") {
    return <div className="activity-row provider-fallback-row">↪ {item.text}</div>;
  }

  if (item.kind === "tool-preparing") {
    return <ToolPreparingEntry item={item} />;
  }

  if (item.kind === "tool") {
    const status = toolStatus(item);
    return (
      <button
        className={item.id === selectedId ? `tool-row ${status.className} selected` : `tool-row ${status.className}`}
        type="button"
        onClick={() => onSelect(item.id)}
      >
        <ToolIcon name={item.call.name} />
        <strong>{item.call.name}</strong>
        {item.call.inputRepair ? (
          <span className="tool-healed" title={item.call.inputRepair}>healed</span>
        ) : null}
        <span>{status.label}</span>
      </button>
    );
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
              <>{item.text}<span className="streaming-cursor" aria-hidden="true" /></>
            ) : (
              <MarkdownContent text={item.text} {...(item.sources ? { sources: item.sources } : {})} />
            )}
          </div>
          {!item.streaming && !item.intermediate ? (
            <MessageFooter
              text={item.text}
              metadata={modelMetadata(item)}
              saved={Boolean(savedId)}
              {...(onFork && item.sequence !== undefined
                ? { onFork: () => onFork(item.sequence!) }
                : {})}
              {...(onToggleSaved ? { onSave: () => onToggleSaved(item, savedId) } : {})}
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

function ActivityGroup({
  item,
  selectedId,
  onSelect,
  onResolveApproval,
}: {
  item: Extract<TimelineItem, { kind: "activity-group" }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onResolveApproval?: (id: string, decision: CommandApprovalDecision) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="activity-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Work details</summary>
      {open ? (
        <div className="activity-group-body">
          {item.items.map((child) => (
            <TimelineEntry
              key={child.id}
              item={child}
              selectedId={selectedId}
              onSelect={onSelect}
              {...(onResolveApproval ? { onResolveApproval } : {})}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function ApprovalEntry({
  item,
  onResolve,
}: {
  item: Extract<TimelineItem, { kind: "approval" }>;
  onResolve?: (id: string, decision: CommandApprovalDecision) => void;
}): JSX.Element {
  if (item.decision) {
    const label = item.decision === "deny"
      ? "Extra access denied"
      : item.decision === "once"
        ? "Extra access allowed once"
        : "Unrestricted for this thread";
    return <div className={`approval-result ${item.decision}`}>{label}</div>;
  }

  return (
    <section className="approval-card">
      <strong>Command needs extra access</strong>
      <code>{item.command}</code>
      <p>
        Restricted execution blocked this command in <code>{item.cwd}</code>. Approval reruns it
        outside the sandbox with your user access.
      </p>
      <div className="approval-actions">
        <button type="button" onClick={() => onResolve?.(item.id, "deny")}>Deny</button>
        <button type="button" onClick={() => onResolve?.(item.id, "once")}>Allow once</button>
        <button type="button" onClick={() => onResolve?.(item.id, "thread")}>Allow for this thread</button>
      </div>
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

  return (
    <article
      className="message user"
      data-timeline-id={item.id}
      {...(item.entryId ? { "data-entry-id": item.entryId } : {})}
    >
      <div className={collapsible && !expanded ? "message-body collapsed" : "message-body"}>
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
      <MessageFooter
        text={item.text}
        compact
        {...(onEdit ? { onEdit: () => onEdit(item.text) } : {})}
        {...(onFork ? { onFork: () => onFork(item.sequence) } : {})}
      >
        {collapsible ? (
          <button className="message-expand" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </MessageFooter>
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
}: {
  text: string;
  metadata?: string;
  children?: ReactNode;
  compact?: boolean;
  onEdit?: () => void;
  onFork?: () => void;
  saved?: boolean;
  onSave?: () => void;
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
}: {
  item: Extract<TimelineItem, { kind: "reasoning" }>;
}): JSX.Element {
  const [open, setOpen] = useState(item.streaming);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(item.streaming), [item.streaming]);
  useEffect(() => {
    if (item.streaming && open && textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [item.text, item.streaming, open]);

  return (
    <details
      className="reasoning-block"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{item.status ?? (item.streaming ? "Thinking…" : "Thinking")}</span>
        {item.streaming ? <span className="activity-spinner" aria-hidden="true" /> : null}
      </summary>
      {item.text ? <div ref={textRef} className="reasoning-text">{item.text}</div> : null}
    </details>
  );
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
