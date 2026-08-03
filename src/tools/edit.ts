import { objectInput, stringField, type Tool } from "./tool.js";

export const editTool: Tool = {
  name: "edit_file",
  description:
    'Apply one or more exact replacements to one file, in order. Example: {"path":"src/app.ts","edits":[{"oldText":"count = count + 1","newText":"count += 1"},{"oldText":"save()","newText":"await save()"}]}. Use one array item for a single edit. If multiple edits fail, retry one item at a time. Never send the whole file as oldText.',
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path." },
      edits: {
        type: "array",
        minItems: 1,
        description:
          'Required. One or more exact replacements, applied in array order. Every item must be an object shaped like {"oldText":"...","newText":"..."}.',
        items: {
          type: "object",
          properties: {
            oldText: {
              type: "string",
              description: "Required. Small exact snippet copied from read_file. It must occur once.",
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

    let content = await workspace.read(filePath);
    for (const [index, rawEdit] of input.edits.entries()) {
      const edit = objectInput(rawEdit);
      const oldText = stringField(edit, "oldText") as string;
      const newText = stringField(edit, "newText", { allowEmpty: true }) as string;
      const occurrences = countOccurrences(content, oldText);

      if (occurrences === 0) {
        throw new Error(
          `Edit ${index + 1}: oldText was not found. Read the file again and retry with a smaller exact snippet. If needed, send one edit in the edits array at a time.`,
        );
      }

      if (occurrences > 1) {
        throw new Error(
          `Edit ${index + 1}: oldText found ${occurrences} times. Include more surrounding text so it identifies one location. If needed, send one edit in the edits array at a time.`,
        );
      }

      content = content.replace(oldText, newText);
    }

    await workspace.write(filePath, content);
    return { content: `Updated ${filePath} with ${input.edits.length} edit(s).` };
  },
};

function countOccurrences(content: string, search: string): number {
  let count = 0;
  let position = 0;

  while ((position = content.indexOf(search, position)) !== -1) {
    count += 1;
    position += search.length;
  }

  return count;
}
