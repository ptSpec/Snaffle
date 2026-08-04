import { createHash } from "node:crypto";
import type { JsonSchema, ToolSpec } from "../protocol.js";
import type { Workspace } from "../workspace.js";

export type ToolResult = {
  content: string;
  exitCode?: number | null;
};

export interface Tool extends ToolSpec {
  inputSchema: JsonSchema;
  exampleInput?: Record<string, unknown>;
  execute(workspace: Workspace, input: unknown): Promise<ToolResult>;
}

export function toolErrorContent(tool: Tool, error: unknown): string {
  const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
  if (!tool.exampleInput) return message;
  return (
    `${message}\n\n` +
    `Here is a valid example input for the ${tool.name} tool. ` +
    `Replace the sample values with values for the current task:\n` +
    JSON.stringify(tool.exampleInput, null, 2)
  );
}

export function contentRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function contentLineCount(content: string): number {
  if (!content) return 0;
  const normalized = content.replaceAll("\r\n", "\n");
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length;
}

export function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    throw new Error(
      "Tool input was a quoted string whose contents could not be parsed as JSON. Send one unquoted JSON object matching the tool schema. Every array item must be a JSON object enclosed in { and }.",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be one JSON object matching the tool schema.");
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
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (!options.allowEmpty && value.length === 0) throw new Error(`${name} must not be empty`);
  return value;
}

export function integerField(
  input: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = input[name];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value as number;
}
