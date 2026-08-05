import { objectInput, stringField, type Tool } from "./tool.js";

export const editTool: Tool = {
  name: "edit_file",
  description:
    "Apply one or more exact-text replacements to one file. Each oldText must match exactly once in the original file, including whitespace. Multiple edits must identify distinct, non-overlapping regions of that original file. Reuse current text already known from a successful read, write, or edit; reread only when the text is unknown or a match fails.",
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
      path: { type: "string", description: "Required. Workspace-relative file path." },
      edits: {
        type: "array",
        minItems: 1,
        description:
          "Required. Exact replacements against the original file. Use one array item for one edit and multiple items for separate regions.",
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
    required: ["path", "edits"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new Error("edits must be a non-empty array");
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
