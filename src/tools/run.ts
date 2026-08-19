import { integerField, objectInput, stringField, ToolInputError, type Tool } from "./tool.js";
import { DEFAULT_TOOL_OUTPUT_CHARS, truncateTail } from "./output.js";

export const runTool: Tool = {
  name: "run_command",
  description:
    "Run one shell command in the workspace and return bounded output. Set network to true when the command needs network access; restricted execution will pause for user approval before running it. If output is long, the final portion is kept because it usually contains the result or error. For a long multiline program, use write_file to create a script, then run that file with a short command.",
  exampleInput: { command: "npm test" },
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Required. Shell command to execute." },
      cwd: { type: "string", description: "Optional. Workspace-relative working directory; omit to use the workspace root. Never send an empty string." },
      timeoutMs: { type: "integer", description: "Optional. Timeout in milliseconds; defaults to 120000.", minimum: 1000, maximum: 300000 },
      network: { type: "boolean", description: "Optional. Set true when the command requires network access. This requires user approval in restricted execution." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(workspace, rawInput, context) {
    const input = objectInput(rawInput);
    const command = stringField(input, "command") as string;
    const cwd = stringField(input, "cwd", { optional: true });
    const timeoutMs = integerField(input, "timeoutMs", 120000);
    const network = input.network ?? false;

    if (timeoutMs < 1000 || timeoutMs > 300000) {
      throw new ToolInputError("timeoutMs must be between 1000 and 300000");
    }
    if (typeof network !== "boolean") throw new ToolInputError("network must be a boolean");

    const result = await workspace.run(command, cwd, timeoutMs, network, context?.signal);
    const header = [
      result.approval === "thread"
        ? "permission: user allowed unrestricted commands for this thread"
        : result.approval === "response"
          ? "permission: user allowed unrestricted commands for this response"
        : result.approval === "once"
          ? "permission: user allowed this command once"
          : "",
      result.timedOut
        ? `status: timed out after ${timeoutMs}ms`
        : `exit code: ${result.exitCode ?? "unknown"}`,
    ].filter(Boolean).join("\n");
    const output = [
      result.stdout,
      result.stderr ? `[stderr]\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: output
        ? `${header}\n${truncateTail(output, DEFAULT_TOOL_OUTPUT_CHARS - header.length - 1)}`
        : header,
      exitCode: result.exitCode,
    };
  },
};
