import { createHash } from "node:crypto";
import type { JsonSchema, ToolSpec } from "../protocol.js";
import type { Workspace } from "../workspace.js";

export type ToolResult = {
  content: string;
  exitCode?: number | null;
};

export interface Tool extends ToolSpec {
  inputSchema: JsonSchema;
  execute(workspace: Workspace, input: unknown): Promise<ToolResult>;
}

export function contentRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
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
