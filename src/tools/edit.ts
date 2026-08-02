import { objectInput, stringField, type Tool } from "./tool.js";

export const editTool: Tool = {
  name: "edit_file",
  description:
    'Replace one small exact snippet copied from the current file. Example: oldText "count = count + 1", newText "count += 1". Never send the whole file as oldText.',
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Required. Workspace-relative file path." },
      oldText: {
        type: "string",
        description: "Required. Small exact snippet copied from a recent read_file result. Whitespace matters and it must occur once.",
      },
      newText: { type: "string", description: "Required. Replacement text; an empty string deletes oldText." },
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

    if (occurrences === 0) {
      throw new Error(
        "oldText was not found. Read the file again and retry with a smaller exact snippet copied from its current contents.",
      );
    }

    if (occurrences > 1) {
      throw new Error(`oldText found ${occurrences} times. Include more surrounding text so it identifies one location.`);
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
