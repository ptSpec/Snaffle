import type { ToolSpec } from "../protocol.js";
import {
  compactionPreparationThreshold,
  compactionThreshold,
  type CompactionMode,
} from "./budget.js";
import { projectContext, type ContextCheckpoint, type ContextEntry } from "./projection.js";

export type ContextReport = {
  estimatedCharacters: number;
  estimatedTokens: number;
  contextLength: number;
  prepareAtTokens: number;
  compactAtTokens: number;
  checkpointPrepared: boolean;
  preparing: boolean;
  canCompact: boolean;
};

export function buildContextReport(input: {
  entries: ContextEntry[];
  checkpoint: ContextCheckpoint | null;
  tools: ToolSpec[];
  contextLength: number;
  mode: CompactionMode;
  threshold: number;
  preparing: boolean;
}): ContextReport {
  const projection = projectContext(input.entries, input.checkpoint, input.tools);
  const threshold = compactionThreshold(input.contextLength, input.mode, input.threshold);
  const preparationThreshold = compactionPreparationThreshold(
    input.contextLength,
    input.mode,
    input.threshold,
  );
  const latestUser = [...input.entries].reverse().find(
    (entry) => entry.message.role === "user" && !entry.message.internal,
  );
  return {
    estimatedCharacters: projection.estimatedCharacters,
    estimatedTokens: projection.estimatedTokens,
    contextLength: input.contextLength,
    prepareAtTokens: Math.floor(input.contextLength * preparationThreshold / 100),
    compactAtTokens: Math.floor(input.contextLength * threshold / 100),
    checkpointPrepared: Boolean(input.checkpoint),
    preparing: input.preparing,
    canCompact: (latestUser?.sequence ?? 0) - 1 > (input.checkpoint?.throughSequence ?? 0),
  };
}
