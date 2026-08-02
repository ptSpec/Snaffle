import type { JsonSchema, ToolCall } from "./protocol.js";

export type ParsedToolInput = {
  input: unknown;
  repair?: string;
};

export function healToolInput(value: unknown, schema?: JsonSchema): ParsedToolInput {
  let candidate: unknown = value;
  const repairs: string[] = [];

  for (let layer = 0; layer < 2 && typeof candidate === "string"; layer += 1) {
    const text = candidate;
    try {
      candidate = JSON.parse(text);
      if (typeof candidate === "string") {
        repairs.push("Arguments were sent as a quoted JSON string; converted them to a JSON object");
      }
    } catch {
      const syntax = repairJsonSyntax(text, schema);
      if (syntax.text === text) {
        return { input: text, ...(repairs.length ? { repair: repairs.join("; ") } : {}) };
      }
      try {
        candidate = JSON.parse(syntax.text);
        repairs.push(...syntax.repairs);
      } catch {
        return { input: text, ...(repairs.length ? { repair: repairs.join("; ") } : {}) };
      }
    }
  }

  candidate = removeEmptyOptionalStrings(candidate, schema, repairs);
  const healed = candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  return {
    input: candidate,
    ...(healed && repairs.length ? { repair: repairs.join("; ") } : {}),
  };
}

function repairJsonSyntax(
  input: string,
  schema: JsonSchema | undefined,
): { text: string; repairs: string[] } {
  let text = input.replace(/"\]\s*}$/, '"}');
  const repairs = text === input ? [] : ["The JSON ended with an extra ]; removed it"];
  if (!isObject(schema?.properties)) return { text, repairs };

  for (const [name, definition] of Object.entries(schema.properties)) {
    if (!isObject(definition) || definition.type !== "integer") continue;
    const pattern = new RegExp(`("${escapeRegExp(name)}"\\s*:\\s*)\\.(\\d+)`, "g");
    const repaired = text.replace(pattern, (_match, prefix: string, digits: string) => {
      repairs.push(`"${name}" was .${digits}; changed it to ${digits} because it requires an integer`);
      return `${prefix}${digits}`;
    });
    text = repaired;
  }

  return { text, repairs };
}

export function healToolCall(call: ToolCall, schema: JsonSchema): ToolCall {
  const healed = healToolInput(call.input, schema);
  const repair = [call.inputRepair, healed.repair].filter(Boolean).join("; ");
  return {
    ...call,
    input: healed.input,
    ...(repair ? { inputRepair: repair } : {}),
  };
}

function removeEmptyOptionalStrings(
  input: unknown,
  schema: JsonSchema | undefined,
  repairs: string[],
): unknown {
  if (!isObject(input) || !isObject(schema?.properties)) return input;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  let result = input;

  for (const [name, definition] of Object.entries(schema.properties)) {
    if (input[name] !== "" || required.has(name) || !isObject(definition) || definition.type !== "string") {
      continue;
    }
    if (result === input) result = { ...input };
    delete result[name];
    repairs.push(`"${name}" was empty; omitted it because it is optional`);
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
