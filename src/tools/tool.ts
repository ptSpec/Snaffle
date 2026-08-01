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

export function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be an object");
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
