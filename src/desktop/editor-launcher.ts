import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export async function openCodeFile(
  target: string,
  configuredCommand: string,
  argumentsTemplate: string,
): Promise<void> {
  const command = configuredCommand || installedVisualStudioCode() || platformTextEditor();
  await launchEditor(target, command, configuredCommand ? argumentsTemplate : "");
}

function installedVisualStudioCode(): string | undefined {
  if (process.platform === "darwin") {
    return [
      "/Applications/Visual Studio Code.app",
      path.join(homedir(), "Applications/Visual Studio Code.app"),
    ].find(existsSync);
  }
  if (process.platform === "win32") {
    const directory = process.env.LOCALAPPDATA;
    const command = directory && path.join(directory, "Programs/Microsoft VS Code/Code.exe");
    return command && existsSync(command) ? command : undefined;
  }
  return ["/usr/bin/code", "/snap/bin/code"].find(existsSync);
}

function platformTextEditor(): string {
  if (process.platform === "darwin") return "/System/Applications/TextEdit.app";
  if (process.platform === "win32") return "notepad.exe";
  return "gedit";
}

async function launchEditor(target: string, command: string, argumentsTemplate: string): Promise<void> {
  const folder = path.dirname(target);
  const parsed = argumentsTemplate.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((argument) =>
    argument.startsWith('"') && argument.endsWith('"') ? argument.slice(1, -1) : argument
  ) ?? [];
  const hasTarget = parsed.some((argument) => argument.includes("{path}") || argument.includes("{folder}"));
  const args = parsed.map((argument) => argument
    .replaceAll("{path}", target)
    .replaceAll("{folder}", folder));
  if (!hasTarget) args.push(target);

  if (process.platform === "darwin" && /\.app\/?$/i.test(command)) {
    await launch("open", argumentsTemplate
      ? ["-a", command, "--args", ...args]
      : ["-a", command, target]);
    return;
  }

  await launch(command, args);
}

async function launch(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}
