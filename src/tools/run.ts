import { integerField, objectInput, stringField, type Tool } from "./tool.js";

export const runTool: Tool = {
  name: "run_command",
  description: "Run one shell command in the workspace and return bounded output.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "Workspace-relative working directory" },
      timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput) {
    const input = objectInput(rawInput);
    const command = stringField(input, "command") as string;
    const cwd = stringField(input, "cwd", { optional: true });
    const timeoutMs = integerField(input, "timeoutMs", 30000);

    if (timeoutMs < 1000 || timeoutMs > 120000) {
      throw new Error("timeoutMs must be between 1000 and 120000");
    }

    const result = await workspace.run(command, cwd, timeoutMs);
    const output = [
      `exit code: ${result.exitCode ?? "unknown"}`,
      result.stdout,
      result.stderr ? `[stderr]\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: output.slice(0, 12000),
      exitCode: result.exitCode,
    };
  },
};
