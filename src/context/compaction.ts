import type { ModelProvider } from "../providers/provider.js";
import type { RunEvent, ToolSpec } from "../protocol.js";
import {
  compactionPreparationThreshold,
  type CompactionMode,
} from "./budget.js";
import {
  projectContext,
  type ContextCheckpoint,
  type ContextEntry,
} from "./projection.js";
import { serializeForSummary, summaryMessages } from "./summary.js";

type ContextRepository = {
  latest(threadId: string): Promise<ContextCheckpoint | null>;
  entries(threadId: string, checkpoint: ContextCheckpoint | null): Promise<ContextEntry[]>;
  entriesBetween(threadId: string, after: number, through: number): Promise<ContextEntry[]>;
  save(input: {
    threadId: string;
    throughSequence: number;
    createdAfterSequence: number;
    summary: string;
    sourceCharacters: number;
    model: string;
    providerConnectionId: string;
  }): Promise<ContextCheckpoint>;
};

export type ContextCompactionSettings = {
  mode: CompactionMode;
  threshold: number;
};

export type ContextCompactionInput = {
  threadId: string;
  model: string;
  providerConnectionId: string;
  contextLength: number;
  tools: ToolSpec[];
  throughSequence?: number;
};

export class ContextCompactor {
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(private readonly options: {
    repository: ContextRepository;
    settings(): ContextCompactionSettings;
    provider(connectionId: string, model: string): ModelProvider;
    onEvent(threadId: string, event: RunEvent): void;
  }) {}

  schedule(input: ContextCompactionInput): void {
    void this.start(input, false);
  }

  force(input: ContextCompactionInput): Promise<void> {
    return this.start(input, true);
  }

  isRunning(threadId: string): boolean {
    return this.jobs.has(threadId);
  }

  private start(input: ContextCompactionInput, force: boolean): Promise<void> {
    const running = this.jobs.get(input.threadId);
    if (running) return running;
    const job = this.prepare(input, force).finally(() => {
      if (this.jobs.get(input.threadId) === job) this.jobs.delete(input.threadId);
    });
    this.jobs.set(input.threadId, job);
    return job;
  }

  async ready(threadId: string): Promise<void> {
    await this.jobs.get(threadId);
  }

  private async prepare(input: ContextCompactionInput, force: boolean): Promise<void> {
    try {
      const previous = await this.options.repository.latest(input.threadId);
      const entries = await this.options.repository.entries(input.threadId, previous);
      const projection = projectContext(entries, previous, input.tools);
      const settings = this.options.settings();
      const threshold = compactionPreparationThreshold(input.contextLength, settings.mode, settings.threshold);
      if (!force && projection.estimatedTokens < input.contextLength * threshold / 100) return;

      const throughSequence = input.throughSequence ?? compactionBoundary(entries);
      const previousBoundary = previous?.throughSequence ?? -1;
      if (throughSequence <= previousBoundary) return;

      const source = await this.options.repository.entriesBetween(
        input.threadId,
        previousBoundary,
        throughSequence,
      );
      const messages = source.map((entry) => entry.message);
      const serialized = serializeForSummary(messages);
      if (!serialized.trim()) return;
      this.options.onEvent(input.threadId, {
        type: "context.compaction.started",
        afterSequence: projection.lastSequence,
      });

      const response = await this.options.provider(input.providerConnectionId, input.model).complete(
        summaryMessages(messages, previous?.summary, input.contextLength < 50_000),
        [],
        new AbortController().signal,
      );
      if (!response.text.trim()) throw new Error("The summary model returned an empty response");
      const checkpoint = await this.options.repository.save({
        threadId: input.threadId,
        throughSequence,
        createdAfterSequence: projection.lastSequence,
        summary: response.text.trim(),
        sourceCharacters: serialized.length + (previous?.summary.length ?? 0),
        model: input.model,
        providerConnectionId: input.providerConnectionId,
      });
      this.options.onEvent(input.threadId, {
        type: "context.compaction.completed",
        id: checkpoint.id,
        afterSequence: checkpoint.createdAfterSequence,
        sourceCharacters: checkpoint.sourceCharacters,
        summaryCharacters: checkpoint.summaryCharacters,
        summary: checkpoint.summary,
        model: checkpoint.model,
      });
    } catch (error) {
      this.options.onEvent(input.threadId, {
        type: "context.compaction.failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function compactionBoundary(entries: ContextEntry[]): number {
  const latestUser = [...entries].reverse().find((entry) => entry.message.role === "user");
  return (latestUser?.sequence ?? 0) - 1;
}
