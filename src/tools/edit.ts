import { objectInput, stringField, ToolInputError, type Tool } from "./tool.js";

export const editTool: Tool = {
  name: "edit",
  description:
    "Apply exact-text replacements to one file. For one replacement, pass top-level oldText and newText. For multiple replacements, pass an edits JSON array directly, never as a quoted string. Each oldText must match exactly once in the original file, including whitespace, and multiple edits must identify distinct, non-overlapping regions. Reuse current text already known from a successful read, write, or edit; reread only when the text is unknown or a match fails.",
  inputErrorHint:
    "This failure concerns the edit input shape, not the editing strategy. Use top-level oldText and newText for one replacement, or an edits JSON array for multiple replacements; never quote or encode the array as a string. Prefer correcting and retrying edit with the working shape below; rewriting an existing file with write usually uses more tokens and may overwrite unrelated changes.",
  exampleInput: {
    path: "src/app.ts",
    edits: [
      { oldText: "const port = 3000;", newText: "const port = 4000;" },
      { oldText: "const ready = false;", newText: "const ready = true;" },
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path or $TMPDIR temporary path." },
      oldText: {
        type: "string",
        description: "For one replacement. Small exact current text that occurs once, including whitespace.",
      },
      newText: {
        type: "string",
        description: "For one replacement. Replacement text; an empty string deletes oldText.",
      },
      edits: {
        type: "array",
        minItems: 1,
        description:
          "For multiple replacements. Pass the JSON array directly rather than quoting or encoding it as a string. Each item targets a separate region of the original file.",
        items: {
          type: "object",
          properties: {
            oldText: {
              type: "string",
              description: "Required. Small exact current text that occurs once, including whitespace.",
            },
            newText: {
              type: "string",
              description: "Required. Replacement text; an empty string deletes oldText.",
            },
          },
          required: ["oldText", "newText"],
          additionalProperties: false,
        },
      },
    },
    required: ["path"],
    anyOf: [
      { required: ["oldText", "newText"] },
      { required: ["edits"] },
    ],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new ToolInputError("edits must be a non-empty array");
    }

    const original = await workspace.read(filePath);
    const normalized = original.replaceAll("\r\n", "\n");
    const edits = input.edits.map((rawEdit, index) => {
      const edit = objectInput(rawEdit);
      const oldText = (stringField(edit, "oldText") as string).replaceAll("\r\n", "\n");
      const newText = (stringField(edit, "newText", { allowEmpty: true }) as string).replaceAll("\r\n", "\n");
      const start = normalized.indexOf(oldText);
      if (start === -1) {
        throw new Error(`Edit ${index + 1}: oldText was not found. Read the file and retry with exact current text.`);
      }
      if (normalized.indexOf(oldText, start + 1) !== -1) {
        throw new Error(`Edit ${index + 1}: oldText matched more than once. Include more surrounding text.`);
      }
      return { start, end: start + oldText.length, newText };
    });

    const ordered = [...edits].sort((left, right) => left.start - right.start);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.start < ordered[index - 1]!.end) {
        throw new Error("Exact edit regions must not overlap");
      }
    }

    let updated = normalized;
    for (const edit of ordered.reverse()) {
      updated = updated.slice(0, edit.start) + edit.newText + updated.slice(edit.end);
    }
    if (original.includes("\r\n")) updated = updated.replaceAll("\n", "\r\n");
    await workspace.write(filePath, updated);
    return { content: `Successfully replaced ${edits.length} block(s) in ${filePath}.` };
  },
};
