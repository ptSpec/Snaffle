import { objectInput, stringField, type Tool } from "./tool.js";

export const editTool: Tool = {
  name: "edit_file",
  description: "Replace one exact, unique text block in an existing file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path" },
      oldText: { type: "string", description: "Exact text that occurs once" },
      newText: { type: "string", description: "Replacement text; empty deletes oldText" },
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const filePath = stringField(input, "path") as string;
    const oldText = stringField(input, "oldText") as string;
    const newText = stringField(input, "newText", { allowEmpty: true }) as string;
    const content = await workspace.read(filePath);
    const occurrences = countOccurrences(content, oldText);

    if (occurrences !== 1) {
      throw new Error(`oldText must occur exactly once; found ${occurrences}`);
    }

    await workspace.write(filePath, content.replace(oldText, newText));
    return { content: `Updated ${filePath}.` };
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
