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
import type { Message, RunEvent, ToolCall, Usage } from "../../protocol.js";

export type TimelineItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean; intermediate?: boolean; model?: string; usage?: Usage; durationMs?: number }
  | { id: string; kind: "activity-group"; items: TimelineItem[] }
  | { id: string; kind: "reasoning"; step: number; text: string; streaming: boolean; status?: string | undefined }
  | { id: string; kind: "tool-preparing"; step: number; index: number; name: string }
  | { id: string; kind: "retry"; step: number; attempt: number; maxRetries: number; text: string }
  | {
      id: string;
      kind: "tool";
      call: ToolCall;
      phase: "running" | "completed";
      content?: string;
      isError?: boolean;
      exitCode?: number | null;
    };

let itemNumber = 0;

export function TimelineEntry({
  item,
  selectedId,
  onSelect,
  onEditUser,
}: {
  item: TimelineItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEditUser?: (text: string) => void;
}): JSX.Element {
  if (item.kind === "activity-group") {
    return (
      <ActivityGroup
        item={item}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    );
  }

  if (item.kind === "reasoning") return <ReasoningEntry item={item} />;

  if (item.kind === "retry") {
    return (
      <div className="activity-row retry-row" title={item.text}>
        <span aria-hidden="true">↻</span>
        <span>Retry {item.attempt}/{item.maxRetries}</span>
      </div>
    );
  }

  if (item.kind === "tool-preparing") {
    return (
      <div className="activity-row">
        <span className="activity-spinner" aria-hidden="true" />
        <span>{toolGeneratingLabel(item.name)}</span>
      </div>
    );
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
      <article className={item.intermediate ? "message assistant intermediate" : "message assistant"}>
        <div className={item.streaming ? "markdown-content streaming" : "markdown-content"}>
          {item.streaming ? (
            <>{item.text}<span className="streaming-cursor" aria-hidden="true" /></>
          ) : (
            <MarkdownContent text={item.text} />
          )}
        </div>
        {!item.streaming && !item.intermediate ? (
          <MessageFooter text={item.text} metadata={modelMetadata(item)} />
        ) : null}
      </article>
    );
  }

  if (item.kind === "user") {
    return <UserMessage item={item} {...(onEditUser ? { onEdit: onEditUser } : {})} />;
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
}: {
  item: Extract<TimelineItem, { kind: "activity-group" }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <details className="activity-group">
      <summary>Work details</summary>
      <div className="activity-group-body">
        {item.items.map((child) => (
          <TimelineEntry
            key={child.id}
            item={child}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </details>
  );
}

const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }): JSX.Element {
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
    <article className="message user">
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
}: {
  text: string;
  metadata?: string;
  children?: ReactNode;
  compact?: boolean;
  onEdit?: () => void;
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
        <button type="button" onClick={() => void copy()} title="Copy message" aria-label="Copy message">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="1.5" />
            <path d="M3 10.5H2.5V3A1.5 1.5 0 0 1 4 1.5h7.5V2" />
          </svg>
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
        {item.streaming ? <span className="activity-spinner" aria-hidden="true" /> : null}
        <span>{item.status ?? (item.streaming ? "Thinking…" : "Thinking")}</span>
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
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : null;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language}</span>
        <button type="button" onClick={() => void copyCode()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
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

export function Inspector({ item }: { item: TimelineItem }): JSX.Element {
  if (item.kind === "activity-group") {
    return <div className="inspector-card">Work details</div>;
  }
  if (item.kind === "tool-preparing") {
    return <div className="inspector-card">{toolGeneratingLabel(item.name)}</div>;
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
      <pre>{formatJson(item.call.input)}</pre>
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

export function addRunEvent(
  event: RunEvent,
  setTimeline: (update: (items: TimelineItem[]) => TimelineItem[]) => void,
): void {
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
          },
        ];
      }
      return ready.map((item, index) =>
        index === existing && item.kind === "tool-preparing"
          ? { ...item, name: event.name }
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
            ? { ...item, text: event.response.text, streaming: false, intermediate, ...metadata }
            : item,
        );
      } else if (event.response.text.trim()) {
        completed = [
          ...completedReasoning,
          { id: newTimelineId(), kind: "assistant", text: event.response.text, streaming: false, intermediate, ...metadata },
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
      const completed: TimelineItem = {
        id: event.call.id,
        kind: "tool",
        call: event.call,
        phase: "completed",
        content: event.content,
        isError: event.isError,
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
      };
      const existing = items.findIndex((item) => item.id === event.call.id);
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

export function timelineFromMessages(messages: Message[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const calls = new Map<string, ToolCall>();

  messages.forEach((message, index) => {
    if (message.role === "system") return;
    if (message.role === "user") {
      items.push({ id: `history-${index}`, kind: "user", text: message.content });
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
          id: `history-${index}`,
          kind: "assistant",
          text: message.content,
          streaming: false,
          intermediate,
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

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
