import { useState, type ReactNode } from "react";
import type { SubagentRunActivity } from "../../../../agent/subagents/activity.js";
import type { Usage } from "../../../../protocol.js";
import type { TimelineItem } from "../conversation/timeline-state.js";

type ExecutionTurn = {
  id: string;
  title: string;
  items: TimelineItem[];
  usage: Usage;
};

export function ExecutionOverview({
  timeline,
  running,
  selectedModel,
  selectedProviderConnectionId,
  providerNames,
  onSelect,
  onNavigateTurn,
}: {
  timeline: TimelineItem[];
  running: boolean;
  selectedModel: string;
  selectedProviderConnectionId: string;
  providerNames: Record<string, string>;
  onSelect(id: string): void;
  onNavigateTurn(id: string): void;
}): JSX.Element {
  const turns = executionTurns(timeline);
  const threadUsage = sumUsage(turns.map((turn) => turn.usage));

  return (
    <div className="execution-overview">
      <div className="execution-overview-heading">
        <div>
          <p className="eyebrow">Execution overview</p>
          <h3>Whole thread</h3>
        </div>
        <span className="execution-turn-count">
          <span>{turns.length} turn{turns.length === 1 ? "" : "s"}</span>
          {threadUsage.totalTokens ? <strong>{compactNumber(threadUsage.totalTokens)} tokens processed</strong> : null}
          {threadUsage.costUsd ? <strong>{formatCost(threadUsage.costUsd)}</strong> : null}
        </span>
      </div>

      {turns.length ? (
        <div className="execution-turns">
          {turns.map((turn, index) => (
            <TurnOverview
              key={turn.id}
              turn={turn}
              latest={index === turns.length - 1}
              running={running && index === turns.length - 1}
              selectedModel={selectedModel}
              selectedProviderConnectionId={selectedProviderConnectionId}
              providerNames={providerNames}
              onSelect={onSelect}
              onNavigateTurn={onNavigateTurn}
            />
          ))}
        </div>
      ) : (
        <p className="execution-empty">Execution activity will appear here after the first message.</p>
      )}
    </div>
  );
}

function TurnOverview({
  turn,
  latest,
  running,
  selectedModel,
  selectedProviderConnectionId,
  providerNames,
  onSelect,
  onNavigateTurn,
}: {
  turn: ExecutionTurn;
  latest: boolean;
  running: boolean;
  selectedModel: string;
  selectedProviderConnectionId: string;
  providerNames: Record<string, string>;
  onSelect(id: string): void;
  onNavigateTurn(id: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(latest);
  const [modelCallsOpen, setModelCallsOpen] = useState(latest);
  const [toolsOpen, setToolsOpen] = useState(false);
  const items = flatten(turn.items);
  const tools = items.filter((item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool");
  const responses = items.filter((item): item is Extract<TimelineItem, { kind: "assistant" }> => item.kind === "assistant");
  const agents = tools.flatMap((tool) => tool.details?.runs ?? []);
  const failed = items.some((item) => item.kind === "error") ||
    tools.some((tool) => tool.isError) ||
    agents.some((agent) => agent.status === "failed");
  const status = failed ? "failed" : running ? "running" : "completed";
  const latestResponse = responses.at(-1);
  const model = latestResponse?.model ?? selectedModel;
  const connectionId = latestResponse?.providerConnectionId ?? selectedProviderConnectionId;
  const usage = turn.usage;

  return (
    <section className={`execution-turn ${status}`}>
      <div className="execution-turn-heading">
        <button
          className={open ? "execution-caret open" : "execution-caret"}
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse turn details" : "Expand turn details"}
          onClick={() => setOpen((value) => !value)}
        >›</button>
        <button
          className="execution-turn-copy"
          type="button"
          onClick={() => {
            setOpen(true);
            onNavigateTurn(turn.id);
          }}
        >
          <strong>{turn.title}</strong>
          <small>{turnMetadata(tools.length, agents.length, usage)}</small>
        </button>
        <span className={`execution-status ${status}`}>{status}</span>
      </div>

      {open ? (
        <div className="execution-turn-body">
          <ExecutionGroup
            label="Model calls"
            count={responses.length}
            open={modelCallsOpen}
            onToggle={() => setModelCallsOpen((value) => !value)}
          >
            {responses.length ? responses.map((response, index) => {
              const responseModel = response.model || model || "Model pending";
              const responseConnection = response.providerConnectionId || connectionId;
              const provider = responseConnection
                ? providerNames[responseConnection] ?? responseConnection
                : "Provider pending";
              const previous = responses[index - 1];
              const contextChanged = !previous ||
                previous.model !== response.model ||
                previous.providerConnectionId !== response.providerConnectionId;
              return (
                <div key={response.id}>
                  {contextChanged ? (
                    <p className="execution-call-context">{responseModel} · {provider}</p>
                  ) : null}
                  <button className="execution-call" type="button" onClick={() => onSelect(response.id)}>
                    <span className="execution-node-marker" aria-hidden="true" />
                    <strong>Call {index + 1}</strong>
                    <small>{response.usage ? compactUsage(response.usage) : "Usage unavailable"}</small>
                    <time>{response.durationMs ? formatDuration(response.durationMs) : "—"}</time>
                  </button>
                </div>
              );
            }) : <p className="execution-empty">Waiting for the first model call.</p>}
          </ExecutionGroup>

          {tools.length ? (
            <ExecutionGroup
              label="Tool activity"
              count={tools.length}
              open={toolsOpen}
              onToggle={() => setToolsOpen((value) => !value)}
            >
              <div className="execution-tree">
                {tools.map((tool) => (
                  <div className="execution-branch" key={tool.id}>
                    <ExecutionNode
                      label={tool.call.name}
                      detail={tool.phase === "running" ? "running" : tool.isError ? "failed" : "completed"}
                      status={tool.phase === "running" ? "running" : tool.isError ? "failed" : "completed"}
                      onClick={() => onSelect(tool.id)}
                    />
                    {tool.details?.runs?.length ? (
                      <div className="execution-children">
                        {tool.details.runs.map((run) => (
                          <ExecutionNode
                            key={run.id}
                            label={run.task}
                            detail={subagentDetail(run, providerNames)}
                            status={run.status}
                            onClick={() => onSelect(tool.id)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </ExecutionGroup>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExecutionGroup({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="execution-group">
      <button type="button" className="execution-group-heading" onClick={onToggle} aria-expanded={open}>
        <span className={open ? "execution-caret open" : "execution-caret"}>›</span>
        <strong>{label}</strong>
        <small>{count}</small>
      </button>
      {open ? <div className="execution-group-body">{children}</div> : null}
    </section>
  );
}

function ExecutionNode({
  label,
  detail,
  status,
  onClick,
}: {
  label: string;
  detail: string;
  status: string;
  onClick(): void;
}): JSX.Element {
  return (
    <button className={`execution-node ${status}`} type="button" onClick={onClick}>
      <span className="execution-node-marker" aria-hidden="true" />
      <span className="execution-node-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

function executionTurns(timeline: TimelineItem[]): ExecutionTurn[] {
  const turns: Array<Omit<ExecutionTurn, "usage">> = [];
  for (const item of timeline) {
    if (item.kind === "user") {
      turns.push({ id: item.id, title: oneLine(item.text), items: [] });
    } else {
      turns.at(-1)?.items.push(item);
    }
  }
  return turns.map((turn) => ({ ...turn, usage: usageForItems(turn.items) }));
}

function flatten(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap((item) => item.kind === "activity-group" ? flatten(item.items) : [item]);
}

function usageForItems(items: TimelineItem[]): Usage {
  const flattened = flatten(items);
  const responses = flattened.filter((item): item is Extract<TimelineItem, { kind: "assistant" }> => item.kind === "assistant");
  const agents = flattened
    .filter((item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool")
    .flatMap((tool) => tool.details?.runs ?? []);
  return totalUsage(responses, agents);
}

function totalUsage(
  responses: Array<Extract<TimelineItem, { kind: "assistant" }>>,
  agents: SubagentRunActivity[],
): Usage {
  const usages = [
    ...responses.map((response) => response.usage),
    ...agents.flatMap((agent) => agent.steps.map((step) => step.usage)),
  ].filter((usage): usage is Usage => Boolean(usage));
  return sumUsage(usages);
}

function sumUsage(usages: Usage[]): Usage {
  return usages.reduce<Usage>((total, usage) => ({
    inputTokens: (total.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
    cachedInputTokens: (total.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
    reasoningTokens: (total.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
    costUsd: (total.costUsd ?? 0) + (usage.costUsd ?? 0),
  }), {});
}

function turnMetadata(toolCount: number, agentCount: number, usage: Usage): string {
  const parts = [
    `${toolCount} tool${toolCount === 1 ? "" : "s"}`,
    `${agentCount} subagent${agentCount === 1 ? "" : "s"}`,
  ];
  if (usage.totalTokens) parts.push(`${compactNumber(usage.totalTokens)} tokens processed`);
  if (usage.cachedInputTokens) parts.push(`${compactNumber(usage.cachedInputTokens)} cached`);
  if (usage.costUsd) parts.push(formatCost(usage.costUsd));
  return parts.join(" · ");
}

function compactUsage(usage: Usage): string {
  const input = compactNumber(usage.inputTokens ?? 0);
  const output = compactNumber(usage.outputTokens ?? 0);
  const cached = usage.cachedInputTokens
    ? ` (${compactNumber(usage.cachedInputTokens)} cached)`
    : "";
  const cost = usage.costUsd ? ` · ${formatCost(usage.costUsd)}` : "";
  return `${input}${cached} → ${output}${cost}`;
}

function subagentDetail(run: SubagentRunActivity, providerNames: Record<string, string>): string {
  const toolCount = run.steps.reduce((total, step) => total + step.tools.length, 0);
  const durationMs = run.steps.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  const provider = run.providerConnectionId
    ? providerNames[run.providerConnectionId] ?? run.providerConnectionId
    : "provider pending";
  return `${run.status} · ${run.model ?? "model pending"} via ${provider} · ${toolCount} tool${toolCount === 1 ? "" : "s"}${durationMs ? ` · ${formatDuration(durationMs)}` : ""}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim() || "Untitled turn";
}

function compactNumber(value: number): string {
  return value < 1_000 ? String(value) : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`;
}

function formatCost(costUsd: number): string {
  const decimals = costUsd < 0.01 ? 6 : costUsd < 1 ? 4 : 2;
  return `$${costUsd.toFixed(decimals)}`;
}
