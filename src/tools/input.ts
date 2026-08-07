import type { JsonSchema, ToolCall } from "../protocol.js";

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

  candidate = parseStringifiedProperties(candidate, schema, repairs);
  candidate = wrapSingleArrayItems(candidate, schema, repairs);
  candidate = removeEmptyOptionalStrings(candidate, schema, repairs);
  const healed = candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  return {
    input: candidate,
    ...(healed && repairs.length ? { repair: repairs.join("; ") } : {}),
  };
}

function parseStringifiedProperties(
  input: unknown,
  schema: JsonSchema | undefined,
  repairs: string[],
): unknown {
  if (!isObject(input) || !isObject(schema?.properties)) return input;
  let result = input;

  for (const [name, definition] of Object.entries(schema.properties)) {
    if (!isObject(definition) || typeof input[name] !== "string") continue;
    if (definition.type !== "array" && definition.type !== "object") continue;
    try {
      const parsed: unknown = JSON.parse(input[name]);
      const matches = definition.type === "array" ? Array.isArray(parsed) : isObject(parsed);
      if (!matches) continue;
      if (result === input) result = { ...input };
      result[name] = parsed;
      repairs.push(`"${name}" was ${definition.type} JSON sent as a string; parsed it`);
    } catch {
      // Leave invalid strings for normal tool validation and its useful error.
    }
  }

  return result;
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
  const repairedObject = isObject(healed.input);
  const repair = repairedObject
    ? [call.inputRepair, healed.repair].filter(Boolean).join("; ")
    : "";
  return {
    ...call,
    input: healed.input,
    ...(repair ? { inputRepair: repair } : {}),
  };
}

function wrapSingleArrayItems(
  input: unknown,
  schema: JsonSchema | undefined,
  repairs: string[],
): unknown {
  if (!isObject(input) || !isObject(schema?.properties)) return input;
  let result = input;

  for (const [name, definition] of Object.entries(schema.properties)) {
    if (!isObject(definition) || definition.type !== "array" || !isObject(input[name])) continue;
    if (result === input) result = { ...input };
    result[name] = [input[name]];
    repairs.push(`"${name}" was one object; wrapped it in an array`);
  }

  return result;
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
