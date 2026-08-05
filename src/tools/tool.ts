import type { JsonSchema, SourceReference, ToolSpec } from "../protocol.js";
import type { Workspace } from "../workspace.js";

export type ToolResult = {
  content: string;
  exitCode?: number | null;
  sources?: SourceReference[];
};

export interface Tool extends ToolSpec {
  inputSchema: JsonSchema;
  exampleInput?: Record<string, unknown>;
  execute(workspace: Workspace, input: unknown): Promise<ToolResult>;
}

export class ToolInputError extends Error {}

export function toolErrorContent(tool: Tool, error: unknown): string {
  const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
  if (!tool.exampleInput || !(error instanceof ToolInputError)) return message;
  return (
    `${message}\n\n` +
    `Here is a valid example input for the ${tool.name} tool. ` +
    `Replace the sample values with values for the current task:\n` +
    JSON.stringify(tool.exampleInput, null, 2)
  );
}

export function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    throw new ToolInputError(
      "Tool input was a quoted string whose contents could not be parsed as JSON. Send one unquoted JSON object matching the tool schema. Every array item must be a JSON object enclosed in { and }.",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolInputError("Tool input must be one JSON object matching the tool schema.");
  }
  return input as Record<string, unknown>;
}

export function stringField(
  input: Record<string, unknown>,
  name: string,
  options: { optional?: boolean; allowEmpty?: boolean } = {},
): string | undefined {
  const value = input[name];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string") throw new ToolInputError(`${name} must be a string`);
  if (!options.allowEmpty && value.length === 0) throw new ToolInputError(`${name} must not be empty`);
  return value;
}

export function integerField(
  input: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = input[name];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) throw new ToolInputError(`${name} must be an integer`);
  return value as number;
}
