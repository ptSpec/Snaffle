import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import type { CommandApprovalDecision, RunEvent, ToolCall, Usage } from "../../protocol.js";
import type { DesktopEntry } from "../api.js";
import { JsonInspector } from "./json-inspector.js";

export type TimelineItem =
  | { id: string; kind: "user"; text: string; sequence: number; entryId?: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean; intermediate?: boolean; model?: string; usage?: Usage; durationMs?: number; sequence?: number; entryId?: string }
  | { id: string; kind: "activity-group"; items: TimelineItem[] }
  | { id: string; kind: "reasoning"; step: number; text: string; streaming: boolean; status?: string | undefined }
  | { id: string; kind: "tool-preparing"; step: number; index: number; name: string; argumentChars: number; startedAt: number }
  | { id: string; kind: "retry"; step: number; attempt: number; maxRetries: number; text: string }
  | { id: string; kind: "approval"; command: string; cwd: string; reason: string; decision?: CommandApprovalDecision }
  | {
      id: string;
      kind: "tool";
      call: ToolCall;
      phase: "running" | "completed";
      content?: string;
      isError?: boolean;
      exitCode?: number | null;
      sequence?: number;
    };

let itemNumber = 0;

export function TimelineEntry({
  item,
  selectedId,
  onSelect,
  onEditUser,
  onResolveApproval,
  savedId,
  onToggleSaved,
}: {
  item: TimelineItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEditUser?: (text: string) => void;
  onResolveApproval?: (id: string, decision: CommandApprovalDecision) => void;
  savedId?: string | undefined;
  onToggleSaved?: (item: SaveableTimelineItem, savedId?: string) => void;
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
    return (
      <article
        className={item.intermediate ? "message assistant intermediate" : "message assistant"}
        {...(item.entryId ? { "data-entry-id": item.entryId } : {})}
      >
        <div className={item.streaming ? "markdown-content streaming" : "markdown-content"}>
          {item.streaming ? (
            <>{item.text}<span className="streaming-cursor" aria-hidden="true" /></>
          ) : (
            <MarkdownContent text={item.text} />
          )}
        </div>
        {!item.streaming && !item.intermediate ? (
          <MessageFooter
            text={item.text}
            metadata={modelMetadata(item)}
            saved={Boolean(savedId)}
            {...(onToggleSaved ? { onSave: () => onToggleSaved(item, savedId) } : {})}
          />
        ) : null}
      </article>
    );
  }

  if (item.kind === "user") {
    return (
      <UserMessage
        item={item}
        {...(onEditUser ? { onEdit: onEditUser } : {})}
      />
    );
  }

  return (
    <article className={`message ${item.kind}`}>
      {item.kind === "error" ? <span className="message-label">Run failed</span> : null}
      <p>{item.text}</p>
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

export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }): JSX.Element {
  return (
    <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
      {text}
    </ReactMarkdown>
  );
});

function UserMessage({
  item,
  onEdit,
}: {
  item: Extract<TimelineItem, { kind: "user" }>;
  onEdit?: (text: string) => void;
}): JSX.Element {
  const collapsible = item.text.length > 1000 || item.text.split("\n").length > 12;
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="message user" {...(item.entryId ? { "data-entry-id": item.entryId } : {})}>
      <div className={collapsible && !expanded ? "message-body collapsed" : "message-body"}>
        <p>{item.text}</p>
      </div>
      <MessageFooter
        text={item.text}
        compact
        {...(onEdit ? { onEdit: () => onEdit(item.text) } : {})}
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
  saved = false,
  onSave,
}: {
  text: string;
  metadata?: string;
  children?: ReactNode;
  compact?: boolean;
  onEdit?: () => void;
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

const markdownComponents: Components = {
  a({ href, children }) {
    const external = href?.startsWith("https://") || href?.startsWith("http://");
    return (
      <a
        href={external ? href : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (external && href) void window.desktop.openExternal(href);
        }}
      >
        {children}
      </a>
    );
  },
  pre: CodeBlock,
};

function CodeBlock({ children }: ComponentProps<"pre">): JSX.Element {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <pre>{children}</pre>;
  }

  const code = String(child.props.children).replace(/\n$/, "");
  const language = /language-([\w-]+)/.exec(child.props.className ?? "")?.[1] ?? "text";
  const actionPositions = code.split("\n").length >= 8 ? ["top", "bottom"] : ["bottom"];
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : null;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      {actionPositions.map((position) => (
        <div className={`code-block-actions ${position}`} key={position}>
          <span className="code-block-language">{language}</span>
          <span className="code-block-action-separator" aria-hidden="true">/</span>
          <button
            className={copied ? "copied" : ""}
            type="button"
            onClick={() => void copyCode()}
            title={copied ? "Copied" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            <CopyIcon />
          </button>
        </div>
      ))}
      <pre>
        {highlighted ? (
          <code
            className={child.props.className}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5H2.5V3A1.5 1.5 0 0 1 4 1.5h7.5V2" />
    </svg>
  );
}

export function Inspector({ item }: { item: TimelineItem }): JSX.Element {
  if (item.kind === "activity-group") {
    return <div className="inspector-card">Work details</div>;
  }
  if (item.kind === "tool-preparing") {
    return <div className="inspector-card">{toolGeneratingLabel(item.name)}</div>;
  }
  if (item.kind === "approval") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">Command approval</p>
        <JsonInspector value={{ command: item.command, cwd: item.cwd, reason: item.reason }} />
      </div>
    );
  }
  if (item.kind !== "tool") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">{labelFor(item.kind)}</p>
        <p>{item.text}</p>
      </div>
    );
  }

  const status = toolStatus(item);
  return (
    <div className="inspector-card">
      <p className="eyebrow">Tool call</p>
      <h3>{item.call.name}</h3>
      <p className={`inspector-status ${status.className}`}>
        {status.marker} {status.label}
      </p>
      {item.call.inputRepair ? (
        <p className="inspector-repair"><strong>Input healed</strong> · {item.call.inputRepair}</p>
      ) : null}
      <h4>Input</h4>
      <JsonInspector value={item.call.input} />
      {item.phase === "completed" ? (
        <>
          <h4>Output</h4>
          <pre>{item.content || "No output"}</pre>
        </>
      ) : (
        <p className="muted">Waiting for the tool result.</p>
      )}
    </div>
  );
}

function toolGeneratingLabel(name: string): string {
  if (name === "run_command") return "Generating command…";
  return name ? `Generating ${name} call…` : "Generating tool call…";
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

export function addRunEvent(
  event: RunEvent,
  setTimeline: (update: (items: TimelineItem[]) => TimelineItem[]) => void,
): void {
  if (event.type === "permission.requested") {
    setTimeline((items) => [
      ...items,
      {
        id: event.id,
        kind: "approval",
        command: event.command,
        cwd: event.cwd,
        reason: event.reason,
      },
    ]);
    return;
  }

  if (event.type === "permission.resolved") {
    setTimeline((items) => items.map((item) =>
      item.kind === "approval" && item.id === event.id
        ? { ...item, decision: event.decision }
        : item,
    ));
    return;
  }

  if (event.type === "model.started") {
    setTimeline((items) => [
      ...items,
      { id: newTimelineId(), kind: "reasoning", step: event.step, text: "", streaming: true },
    ]);
    return;
  }

  if (event.type === "model.reasoning.delta" && event.text) {
    setTimeline((items) =>
      items.map((item) =>
        item.kind === "reasoning" && item.step === event.step && item.streaming
          ? { ...item, text: item.text + event.text, status: undefined }
          : item,
      ),
    );
    return;
  }

  if (event.type === "model.retry") {
    setTimeline((items) => {
      const ready = finishReasoning(
        items.filter(
          (item) =>
            !(item.kind === "assistant" && item.streaming) &&
            !(item.kind === "tool-preparing" && item.step === event.step),
        ),
        event.step,
        "",
      );
      return [
        ...ready,
        {
          id: newTimelineId(),
          kind: "retry",
          step: event.step,
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          text: event.message,
        },
        { id: newTimelineId(), kind: "reasoning", step: event.step, text: "", streaming: true },
      ];
    });
    return;
  }

  if (event.type === "model.tool.delta") {
    setTimeline((items) => {
      const ready = finishReasoning(items, event.step, "");
      const existing = ready.findIndex(
        (item) =>
          item.kind === "tool-preparing" &&
          item.step === event.step &&
          item.index === event.index,
      );
      if (existing === -1) {
        return [
          ...ready,
          {
            id: newTimelineId(),
            kind: "tool-preparing",
            step: event.step,
            index: event.index,
            name: event.name,
            argumentChars: event.argumentChars,
            startedAt: Date.now(),
          },
        ];
      }
      return ready.map((item, index) =>
        index === existing && item.kind === "tool-preparing"
          ? { ...item, name: event.name, argumentChars: event.argumentChars }
          : item,
      );
    });
    return;
  }

  if (event.type === "model.delta" && event.text) {
    setTimeline((items) => {
      const ready = finishReasoning(items, event.step, "");
      const existing = streamingAssistantIndex(ready);
      if (existing === -1) {
        return [
          ...ready,
          { id: newTimelineId(), kind: "assistant", text: event.text, streaming: true },
        ];
      }
      return ready.map((item, index) =>
        index === existing && item.kind === "assistant"
          ? { ...item, text: item.text + event.text }
          : item,
      );
    });
    return;
  }

  if (event.type === "model.completed") {
    setTimeline((items) => {
      const completedReasoning = finishReasoning(items, event.step, event.response.reasoning ?? "");
      const existing = streamingAssistantIndex(completedReasoning);
      const intermediate = event.response.toolCalls.length > 0;
      const metadata = {
        model: event.model,
        ...(event.response.usage ? { usage: event.response.usage } : {}),
        durationMs: event.durationMs,
      };
      let completed = completedReasoning;
      if (existing !== -1) {
        completed = completedReasoning.map((item, index) =>
          index === existing && item.kind === "assistant"
            ? { ...item, text: event.response.text, streaming: false, intermediate, sequence: event.sequence, ...metadata }
            : item,
        );
      } else if (event.response.text.trim()) {
        completed = [
          ...completedReasoning,
          { id: newTimelineId(), kind: "assistant", text: event.response.text, streaming: false, intermediate, sequence: event.sequence, ...metadata },
        ];
      }
      return intermediate ? completed : collapseCompletedRuns(completed);
    });
    return;
  }

  if (event.type === "tool.started") {
    setTimeline((items) => [
      ...items.filter(
        (item) =>
          item.kind !== "tool-preparing" ||
          item.step !== event.step ||
          item.index !== event.index,
      ),
      { id: event.call.id, kind: "tool", call: event.call, phase: "running" },
    ]);
    return;
  }

  if (event.type === "tool.completed") {
    setTimeline((items) => {
      const existing = items.findIndex((item) => item.id === event.call.id);
      const runningCall = existing === -1 ? undefined : items[existing];
      const completed: TimelineItem = {
        id: event.call.id,
        kind: "tool",
        call: runningCall?.kind === "tool" ? runningCall.call : event.call,
        phase: "completed",
        content: event.content,
        isError: event.isError,
        sequence: event.sequence,
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
      };
      if (existing === -1) return [...items, completed];
      return items.map((item, index) => (index === existing ? completed : item));
    });
    return;
  }

  if (event.type === "run.failed") {
    setTimeline((items) => [
      ...stopActivity(items),
      { id: newTimelineId(), kind: "error", text: event.message },
    ]);
    return;
  }

}

export function timelineFromEntries(entries: DesktopEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const calls = new Map<string, ToolCall>();

  entries.forEach(({ id: entryId, sequence, message }, index) => {
    if (message.role === "system") return;
    if (message.role === "user") {
      items.push({ id: `entry-${entryId}`, kind: "user", text: message.content, sequence, entryId });
      return;
    }
    if (message.role === "assistant") {
      const intermediate = Boolean(message.toolCalls?.length);
      if (message.reasoning?.trim()) {
        items.push({
          id: `history-reasoning-${index}`,
          kind: "reasoning",
          step: index,
          text: message.reasoning,
          streaming: false,
        });
      }
      if (message.content.trim()) {
        items.push({
          id: `entry-${entryId}`,
          kind: "assistant",
          text: message.content,
          streaming: false,
          intermediate,
          sequence,
          entryId,
          ...(message.model ? { model: message.model } : {}),
          ...(message.usage ? { usage: message.usage } : {}),
          ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
        });
      }
      for (const call of message.toolCalls ?? []) calls.set(call.id, call);
      return;
    }

    if (message.role !== "tool") return;
    const call = calls.get(message.toolCallId);
    if (!call) return;
    items.push({
      id: call.id,
      kind: "tool",
      call,
      phase: "completed",
      content: message.content,
      sequence,
      ...(message.isError === undefined ? {} : { isError: message.isError }),
      ...(message.exitCode === undefined ? {} : { exitCode: message.exitCode }),
    });
  });

  return collapseCompletedRuns(items);
}

export function findTimelineItem(items: TimelineItem[], id: string | null): TimelineItem | null {
  if (!id) return null;
  for (const item of items) {
    if (item.id === id) return item;
    if (item.kind === "activity-group") {
      const child = findTimelineItem(item.items, id);
      if (child) return child;
    }
  }
  return null;
}

function collapseCompletedRuns(items: TimelineItem[]): TimelineItem[] {
  const collapsed: TimelineItem[] = [];
  let run: TimelineItem[] = [];

  function flush(): void {
    if (!run.length) return;
    if (run.some((item) => item.kind === "activity-group")) {
      collapsed.push(...run);
      run = [];
      return;
    }

    let finalIndex = -1;
    for (let index = run.length - 1; index >= 0; index -= 1) {
      const item = run[index];
      if (item?.kind === "assistant" && !item.intermediate && !item.streaming) {
        finalIndex = index;
        break;
      }
    }
    if (finalIndex > 0) {
      collapsed.push(
        { id: newTimelineId(), kind: "activity-group", items: run.slice(0, finalIndex) },
        ...run.slice(finalIndex),
      );
    } else {
      collapsed.push(...run);
    }
    run = [];
  }

  for (const item of items) {
    if (item.kind === "user") {
      flush();
      collapsed.push(item);
    } else {
      run.push(item);
    }
  }
  flush();
  return collapsed;
}

function streamingAssistantIndex(items: TimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "assistant" && item.streaming) return index;
  }
  return -1;
}

function finishReasoning(items: TimelineItem[], step: number, finalText: string): TimelineItem[] {
  return items.flatMap((item) => {
    if (item.kind !== "reasoning" || item.step !== step || !item.streaming) return [item];
    const text = finalText || item.text;
    return text.trim() ? [{ ...item, text, streaming: false }] : [];
  });
}

function stopActivity(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap((item) => {
    if (item.kind === "tool-preparing") return [];
    if (item.kind === "reasoning" && item.streaming) {
      return item.text.trim() ? [{ ...item, streaming: false }] : [];
    }
    if (item.kind === "assistant" && item.streaming) return [{ ...item, streaming: false }];
    return [item];
  });
}

export function newTimelineId(): string {
  itemNumber += 1;
  return `event-${itemNumber}`;
}

export type SaveableTimelineItem = Extract<TimelineItem, { kind: "assistant" }>;

function BookmarkIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="M4 2.5h8v11l-4-2.5-4 2.5z" />
    </svg>
  );
}

function toolStatus(item: Extract<TimelineItem, { kind: "tool" }>): {
  marker: string;
  label: string;
  className: string;
} {
  if (item.phase === "running") return { marker: "…", label: "Running", className: "running" };
  if (item.isError) return { marker: "×", label: "Tool error", className: "tool-error" };
  if (typeof item.exitCode === "number" && item.exitCode !== 0) {
    return { marker: "!", label: `Command exited ${item.exitCode}`, className: "command-error" };
  }
  return { marker: "✓", label: "Completed", className: "success" };
}

function labelFor(kind: Exclude<TimelineItem["kind"], "tool">): string {
  if (kind === "user") return "You";
  if (kind === "assistant") return "Assistant";
  if (kind === "reasoning") return "Thinking";
  if (kind === "tool-preparing") return "Tool call";
  if (kind === "retry") return "Model retry";
  if (kind === "activity-group") return "Work details";
  return "Run failed";
}
