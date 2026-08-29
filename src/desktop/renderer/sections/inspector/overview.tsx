import { useEffect, useRef, useState } from "react";
import type {
  SubagentActivity,
  SubagentProfileName,
  SubagentRunActivity,
} from "../../../../agent/subagents/activity.js";
import type { Usage } from "../../../../protocol.js";
import { UsageDither, type UsageDitherPoint } from "../../components/usage-dither.js";
import type { TimelineItem } from "../conversation/timeline-state.js";

type ExecutionTurn = {
  id: string;
  title: string;
  items: TimelineItem[];
  usage: Usage;
  cacheAvailable: boolean;
};

type ModelCallItem =
  | Extract<TimelineItem, { kind: "assistant" }>
  | Extract<TimelineItem, { kind: "image-understanding" }>;

type ExecutionEvent =
  | { type: "model"; item: ModelCallItem }
  | { type: "image-cache"; item: Extract<TimelineItem, { kind: "image-understanding" }> }
  | { type: "tool"; item: Extract<TimelineItem, { kind: "tool" }> };

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
  const [disclosureCommand, setDisclosureCommand] = useState<{ id: number; open: boolean } | null>(null);
  const turns = executionTurns(timeline);
  const latestTurnId = turns.at(-1)?.id;
  const threadUsage = sumUsage(turns.map((turn) => turn.usage));
  const completeCacheData = turns.every((turn) => !(turn.usage.inputTokens ?? 0) || turn.cacheAvailable);
  const totalTokens = threadUsage.totalTokens ?? 0;
  const cachedTokens = completeCacheData
    ? Math.min(threadUsage.inputTokens ?? 0, threadUsage.cachedInputTokens ?? 0)
    : undefined;
  const usedTokens = Math.max(0, totalTokens - (cachedTokens ?? 0));
  const cachedPercent = cachedTokens !== undefined && threadUsage.inputTokens
    ? Math.round((cachedTokens / threadUsage.inputTokens) * 100)
    : undefined;

  useEffect(() => {
    if (running) setDisclosureCommand(null);
  }, [latestTurnId, running]);

  return (
    <div className="execution-overview">
      <div className="execution-overview-heading">
        <div>
          <p className="eyebrow">Execution overview</p>
          <h3>Whole thread</h3>
        </div>
        {turns.length ? (
          <div className="execution-usage-overview">
            <UsageDither
              points={turns.map<UsageDitherPoint>((turn, index) => ({
                id: turn.id,
                label: `Turn ${index + 1}: ${turn.title}`,
                usage: turn.usage,
                cacheAvailable: turn.cacheAvailable,
              }))}
              onSelect={onNavigateTurn}
            />
            {totalTokens || threadUsage.costUsd ? (
              <div className="execution-token-summary">
                {totalTokens ? (
                  <strong title={`${formatNumber(totalTokens)} total tokens processed`}>
                    {compactNumber(usedTokens)} tokens used
                  </strong>
                ) : <span />}
                <span>
                  {cachedTokens !== undefined && cachedPercent !== undefined ? (
                    <strong>{compactNumber(cachedTokens)} cached · {cachedPercent}%</strong>
                  ) : null}
                  {threadUsage.costUsd ? <strong>{formatCost(threadUsage.costUsd)}</strong> : null}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {turns.length ? (
        <>
          <div className="execution-disclosure-actions">
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
          <div className="execution-turns">
            {turns.map((turn, index) => (
              <TurnOverview
                key={turn.id}
                turn={turn}
                running={running && index === turns.length - 1}
                selectedModel={selectedModel}
                selectedProviderConnectionId={selectedProviderConnectionId}
                providerNames={providerNames}
                onSelect={onSelect}
                onNavigate={onNavigateTurn}
                disclosureCommand={disclosureCommand}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="execution-empty">Execution activity will appear here after the first message.</p>
      )}
    </div>
  );
}

function TurnOverview({
  turn,
  running,
  selectedModel,
  selectedProviderConnectionId,
  providerNames,
  onSelect,
  onNavigate,
  disclosureCommand,
}: {
  turn: ExecutionTurn;
  running: boolean;
  selectedModel: string;
  selectedProviderConnectionId: string;
  providerNames: Record<string, string>;
  onSelect(id: string): void;
  onNavigate(id: string): void;
  disclosureCommand: { id: number; open: boolean } | null;
}): JSX.Element {
  const [open, setOpen] = useState(running);
  const userControlled = useRef(false);
  const items = flatten(turn.items);
  const events = executionEvents(items);
  const tools = events.flatMap((event) => event.type === "tool" ? [event.item] : []);
  const responses = events.flatMap((event) => event.type === "model" && event.item.kind === "assistant" ? [event.item] : []);
  const agents = tools.flatMap((tool) => tool.details?.runs ?? []);
  const failedToolCount = tools.filter((tool) => tool.isError).length;
  const failedAgentCount = agents.filter((agent) => agent.status === "failed").length;
  const issueCount = failedToolCount + failedAgentCount;
  const runFailed = items.some((item) => item.kind === "error");
  const status = runFailed ? "failed" : running ? "running" : issueCount ? "warning" : "completed";
  const issueLabel = failedToolCount === issueCount
    ? `${failedToolCount} tool error${failedToolCount === 1 ? "" : "s"}`
    : `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
  const latestResponse = responses.at(-1);
  const model = latestResponse?.model ?? selectedModel;
  const connectionId = latestResponse?.providerConnectionId ?? selectedProviderConnectionId;
  const usage = turn.usage;

  useEffect(() => {
    if (!userControlled.current) setOpen(running);
  }, [running]);

  useEffect(() => {
    if (disclosureCommand) {
      userControlled.current = true;
      setOpen(disclosureCommand.open);
    }
  }, [disclosureCommand]);

  function toggleOpen(): void {
    userControlled.current = true;
    setOpen((current) => !current);
    onNavigate(turn.id);
  }

  return (
    <section className={`execution-turn ${status}`}>
      <div className="execution-turn-rail" aria-hidden="true"><span /></div>
      <div className="execution-turn-content">
        <div className={`execution-turn-heading ${status}`}>
          <button
            className="execution-turn-copy"
            type="button"
            aria-expanded={open}
            onClick={toggleOpen}
          >
            <strong>{turn.title}</strong>
            <small>{turnMetadata(tools.length, agents.length, usage)}</small>
          </button>
          {status === "completed" ? null : status === "warning" ? (
            <span
              className="execution-status warning"
              aria-label={`Completed with ${issueLabel}`}
              title={`Completed with ${issueLabel}`}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M7.1 2.4 1.6 12a1.1 1.1 0 0 0 1 1.6h10.8a1.1 1.1 0 0 0 1-1.6L8.9 2.4a1 1 0 0 0-1.8 0Z" />
                <path d="M8 5.6v3.6M8 11.5v.1" />
              </svg>
            </span>
          ) : (
            <span className={`execution-status ${status}`}>{status}</span>
          )}
        </div>

        <div
          className={`execution-events-reveal${open ? " open" : ""}`}
          aria-hidden={!open}
        >
          <div className="execution-tree execution-events">
            {events.length ? events.map((event, index) => (
              <ExecutionTimelineEvent
                key={event.item.id}
                event={event}
                model={model}
                connectionId={connectionId}
                previousModelCall={previousModelCall(events, index)}
                providerNames={providerNames}
                onSelect={onSelect}
              />
            )) : <p className="execution-empty">Waiting for the first model call.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExecutionTimelineEvent({
  event,
  model,
  connectionId,
  previousModelCall,
  providerNames,
  onSelect,
}: {
  event: ExecutionEvent;
  model: string;
  connectionId: string;
  previousModelCall: ModelCallItem | undefined;
  providerNames: Record<string, string>;
  onSelect(id: string): void;
}): JSX.Element {
  if (event.type === "tool") {
    const tool = event.item;
    const status = tool.phase === "running" ? "running" : tool.isError ? "failed" : "completed";
    const profile = subagentProfile(tool.details);
    return (
      <div className={`execution-tree-item execution-event tool ${status}`}>
        <span className="execution-tree-marker" aria-hidden="true" />
        <div className="execution-tree-content execution-event-content">
          <button className="execution-event-copy" type="button" onClick={() => onSelect(tool.id)}>
            <strong>{tool.call.name}{profile ? <ProfileBadge profile={profile} /> : null}</strong>
            <small className={`execution-event-status ${status}`}>
              {status === "failed" ? (
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="6" />
                  <path d="m4 4 4 4M8 4 4 8" />
                </svg>
              ) : null}
              {status}
            </small>
            {tool.durationMs ? <time>{formatDuration(tool.durationMs)}</time> : null}
          </button>
          {tool.details?.runs?.length ? (
            <div className="execution-event-children">
              {tool.details.runs.map((run) => {
                const detail = subagentDetail(run, tool.details?.profile, providerNames);
                return (
                  <button
                    key={run.id}
                    className={`execution-subagent ${run.status}`}
                    type="button"
                    title={`${run.task}\n${detail}`}
                    onClick={() => onSelect(tool.id)}
                  >
                    <span aria-hidden="true" />
                    <strong>{run.task}</strong>
                    <small>{detail}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (event.type === "image-cache") {
    const activity = event.item;
    return (
      <div className="execution-tree-item execution-event cache">
        <span className="execution-tree-marker" aria-hidden="true" />
        <div className="execution-tree-content execution-event-content">
          <button className="execution-event-copy" type="button" onClick={() => onSelect(activity.id)}>
            <strong>{activity.activity === "description" ? "Image description cache" : "Image inspection cache"}</strong>
            <small>{activity.imageName} · local cache reuse</small>
          </button>
        </div>
      </div>
    );
  }

  const call = event.item;
  const responseModel = call.model || model || "Model pending";
  const responseConnection = call.providerConnectionId || connectionId;
  const provider = responseConnection
    ? providerNames[responseConnection] ?? responseConnection
    : "Provider pending";
  const contextChanged = !previousModelCall ||
    previousModelCall.model !== call.model ||
    previousModelCall.providerConnectionId !== call.providerConnectionId;
  const label = call.kind === "image-understanding"
    ? call.activity === "description" ? "Image description" : "Image inspection"
    : "Model call";
  const detail = call.usage ? compactUsage(call.usage) : "Usage unavailable";

  return (
    <div className="execution-tree-item execution-event model">
      <span className="execution-tree-marker" aria-hidden="true" />
      <div className="execution-tree-content execution-event-content">
        {contextChanged ? (
          <p className="execution-event-context">{responseModel} · {provider}</p>
        ) : null}
        <button className="execution-event-copy" type="button" onClick={() => onSelect(call.id)}>
          <strong>{label}</strong>
          <small>{detail}</small>
          <time>{call.durationMs ? formatDuration(call.durationMs) : "—"}</time>
        </button>
      </div>
    </div>
  );
}

function previousModelCall(events: ExecutionEvent[], index: number): ModelCallItem | undefined {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const event = events[previous];
    if (event?.type === "model") return event.item;
  }
  return undefined;
}

function executionTurns(timeline: TimelineItem[]): ExecutionTurn[] {
  const turns: Array<Omit<ExecutionTurn, "usage" | "cacheAvailable">> = [];
  for (const item of timeline) {
    if (item.kind === "user") {
      turns.push({ id: item.id, title: oneLine(item.text), items: [] });
    } else {
      turns.at(-1)?.items.push(item);
    }
  }
  return turns.map((turn) => {
    const usages = usagesForItems(turn.items);
    return {
      ...turn,
      usage: sumUsage(usages),
      cacheAvailable: usages.some((usage) => usage.cachedInputTokens !== undefined),
    };
  });
}

function executionEvents(items: TimelineItem[]): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  for (const item of items) {
    if (item.kind === "assistant") events.push({ type: "model", item });
    if (item.kind === "image-understanding") {
      events.push(item.cached ? { type: "image-cache", item } : { type: "model", item });
    }
    if (item.kind === "tool") events.push({ type: "tool", item });
  }
  return events;
}

function flatten(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap((item) => item.kind === "activity-group" ? flatten(item.items) : [item]);
}

function usagesForItems(items: TimelineItem[]): Usage[] {
  const flattened = flatten(items);
  const responses = flattened.filter((item): item is Extract<TimelineItem, { kind: "assistant" }> => item.kind === "assistant");
  const agents = flattened
    .filter((item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool")
    .flatMap((tool) => tool.details?.runs ?? []);
  const imageCalls = flattened.filter((item): item is Extract<TimelineItem, { kind: "image-understanding" }> =>
    item.kind === "image-understanding" && !item.cached);
  return [
    ...responses.map((response) => response.usage),
    ...imageCalls.map((activity) => activity.usage),
    ...agents.flatMap((agent) => agent.steps.map((step) => step.usage)),
  ].filter((usage): usage is Usage => Boolean(usage));
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
  const cached = usage.cachedInputTokens !== undefined
    ? ` (${compactNumber(usage.cachedInputTokens)} cached)`
    : "";
  const cost = usage.costUsd ? ` · ${formatCost(usage.costUsd)}` : "";
  return `${input}${cached} → ${output}${cost}`;
}

function subagentDetail(
  run: SubagentRunActivity,
  profile: string | undefined,
  providerNames: Record<string, string>,
): string {
  const toolCount = run.steps.reduce((total, step) => total + step.tools.length, 0);
  const durationMs = run.steps.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  const provider = run.providerConnectionId
    ? providerNames[run.providerConnectionId] ?? run.providerConnectionId
    : "provider pending";
  return `${profile ?? "explore"} · ${run.status} · ${run.model ?? "model pending"} via ${provider} · ${toolCount} tool${toolCount === 1 ? "" : "s"}${durationMs ? ` · ${formatDuration(durationMs)}` : ""}`;
}

function subagentProfile(activity: SubagentActivity | undefined): SubagentProfileName | undefined {
  if (!activity) return undefined;
  return activity.profile ?? (activity.access === "write" ? "implement" : "explore");
}

function ProfileBadge({ profile }: { profile: SubagentProfileName }): JSX.Element {
  return <span className={`subagent-profile-badge ${profile}`}>{profileLabel(profile)}</span>;
}

function profileLabel(profile: SubagentProfileName): string {
  return profile[0]!.toUpperCase() + profile.slice(1);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim() || "Untitled turn";
}

function compactNumber(value: number): string {
  return value < 1_000 ? String(value) : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`;
}

function formatCost(costUsd: number): string {
  const decimals = costUsd < 0.01 ? 6 : costUsd < 1 ? 4 : 2;
  return `$${costUsd.toFixed(decimals)}`;
}
