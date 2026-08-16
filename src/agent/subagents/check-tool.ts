import { runTool } from "../../tools/run.js";
import { objectInput, stringField, ToolInputError, type Tool } from "../../tools/tool.js";
import type { SubagentProfileName } from "./activity.js";

const gitCommand = /^git\s+(status|diff|log|show)(?:\s|$)/;
const testCommand = /^(npm|pnpm|yarn)\s+(test|run\s+(test|lint|check|typecheck))(?:\s|$)|^(python3?|py)\s+-m\s+pytest(?:\s|$)|^pytest(?:\s|$)|^cargo\s+(test|check)(?:\s|$)|^go\s+test(?:\s|$)|^dotnet\s+test(?:\s|$)|^(mvn|gradle|\.\/gradlew)\s+(test|verify|check)(?:\s|$)/;
const shellComposition = /[;&|<>\n`]|\$\(/;

export function checkCommandTool(profile: Extract<SubagentProfileName, "review" | "test">): Tool {
  return {
    name: "check_command",
    description: profile === "review"
      ? "Run one read-only Git inspection command. Allowed commands begin with git status, git diff, git log, or git show."
      : "Run one verification command such as a test, lint, typecheck, git status, or git diff. Shell chaining and redirection are not allowed.",
    exampleInput: { command: profile === "review" ? "git diff --stat" : "npm test" },
    inputSchema: runTool.inputSchema,
    async execute(workspace, rawInput, context) {
      const input = objectInput(rawInput);
      const command = stringField(input, "command") as string;
      if (shellComposition.test(command)) {
        throw new ToolInputError("command must not contain shell chaining, redirection, command substitution, or newlines");
      }
      if (!gitCommand.test(command) && (profile !== "test" || !testCommand.test(command))) {
        throw new ToolInputError(profile === "review"
          ? "review commands must begin with git status, git diff, git log, or git show"
          : "test commands must be a supported test, lint, typecheck, or read-only Git command");
      }
      return runTool.execute(workspace, input, context);
    },
  };
}
