import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent } from "../dist/src/agent/loop.js";
import { builtInCapabilities } from "../dist/src/capabilities/active.js";
import { SYSTEM_PROMPT } from "../dist/src/context/prompt.js";
import { OpenRouterProvider } from "../dist/src/providers/openrouter.js";
import { editTool } from "../dist/src/tools/edit.js";
import { readTool } from "../dist/src/tools/read.js";
import { runTool } from "../dist/src/tools/run.js";
import { writeTool } from "../dist/src/tools/write.js";
import { LocalWorkspace } from "../dist/src/execution/workspace.js";

const tasks = {
  counter: {
    prompt: `In a new \`counter/\` folder, build a small Python counter with tests.

Work in stages and complete and test each stage before starting the next:

1. Implement increment, decrement, and reset.
2. Add a configurable minimum value that the counter cannot go below.
3. Add undo support for the most recent operation.
4. Add JSON save and load support.

Run the tests after every stage and fix any failures. Do not implement later stages early.`,
    grade: gradeCounter,
  },
  "paper-prompt": {
    prompt: `Can you tell what prompt was used for this paper:
https://arxiv.org/pdf/2608.08654
if its not in this paper find me the prompt`,
    grade: gradePaperPrompt,
  },
};

const model = option("model", "deepseek/deepseek-v4-flash-0731");
const taskName = option("task", "counter");
const task = tasks[taskName];
if (!task) throw new Error(`Unknown task ${JSON.stringify(taskName)}. Choose one of: ${Object.keys(tasks).join(", ")}`);
const prompt = task.prompt;
const snaffleEditName = option("snaffle-edit-name", editTool.name);
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY or place it in .env");

const outputRoot = path.resolve(option("output", `eval-results/harness-comparison-${Date.now()}`));
await mkdir(outputRoot, { recursive: true });

const order = Math.random() < 0.5 ? ["snaffle", "pi"] : ["pi", "snaffle"];
const results = [];
for (const harness of order) {
  results.push(harness === "snaffle" ? await runSnaffle() : await runPi());
}

const report = { createdAt: new Date().toISOString(), task: taskName, model, prompt, snaffleEditName, order, results };
await writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(({ harness, success, uncachedInputTokens, cachedInputTokens, outputTokens, totalTokens, durationMs, failure }) => ({
  harness, success, uncachedInputTokens, cachedInputTokens, outputTokens, totalTokens, durationMs, failure,
})));
console.log(`Saved ${outputRoot}`);

async function runSnaffle() {
  const root = await mkdtemp(path.join(tmpdir(), "snaffle-comparison-"));
  const events = [];
  const workspace = new LocalWorkspace(root, "restricted");
  const comparisonEditTool = snaffleEditName === editTool.name
    ? editTool
    : { ...editTool, name: snaffleEditName };
  const comparisonWriteTool = snaffleEditName === editTool.name
    ? writeTool
    : { ...writeTool, description: writeTool.description.replaceAll(editTool.name, snaffleEditName) };
  const started = Date.now();
  let failure;
  let answer = "";
  try {
    const run = await runAgent({
      task: prompt,
      history: [{ role: "system", content: `${SYSTEM_PROMPT}\nExecution environment: ${workspace.environment}` }],
      provider: new OpenRouterProvider({ model, apiKey }),
      capabilities: builtInCapabilities([runTool, readTool, comparisonEditTool, comparisonWriteTool]),
      workspace,
      trace: { async write(event) { events.push(event); } },
      signal: new AbortController().signal,
      maxSteps: 300,
    });
    answer = run.text;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await workspace.close();
  }
  await writeFile(path.join(outputRoot, "snaffle-trace.json"), `${JSON.stringify(events, null, 2)}\n`);
  await copyWorkspaceSummary(root, "snaffle-files.txt");
  const result = {
    harness: "Snaffle",
    editToolName: snaffleEditName,
    ...(await task.grade({ root, answer })),
    ...usageFromSnaffle(events),
    durationMs: Date.now() - started,
    workspaceCleaned: true,
    answer,
    ...(failure ? { failure } : {}),
  };
  await rm(root, { recursive: true, force: true });
  return result;
}

async function runPi() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-comparison-"));
  const rawPath = path.join(outputRoot, "pi-trace.jsonl");
  const started = Date.now();
  const result = await spawnCapture("pi", [
    "--provider", "openrouter",
    "--model", model,
    "--mode", "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--tools", "read,bash,edit,write",
    prompt,
  ], root);
  await writeFile(rawPath, result.stdout);
  await writeFile(path.join(outputRoot, "pi-stderr.txt"), result.stderr);
  await copyWorkspaceSummary(root, "pi-files.txt");
  const events = result.stdout.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const answer = finalAnswerFromPi(events);
  const run = {
    harness: "Pi",
    ...(await task.grade({ root, answer })),
    ...usageFromPi(events),
    durationMs: Date.now() - started,
    workspaceCleaned: true,
    answer,
    ...(result.failure ? { failure: result.failure } : {}),
  };
  await rm(root, { recursive: true, force: true });
  return run;
}

function usageFromSnaffle(events) {
  const usages = events.filter((event) => event.type === "model.completed").map((event) => event.response.usage).filter(Boolean);
  const { inputTokens, ...usage } = sumUsage(usages);
  return { uncachedInputTokens: Math.max(0, inputTokens - usage.cachedInputTokens), ...usage };
}

function usageFromPi(events) {
  const usages = events
    .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
    .map((event) => event.message.usage)
    .filter(Boolean);
  const { inputTokens, ...total } = sumUsage(usages.map((usage) => ({
    inputTokens: number(usage.input) ?? number(usage.inputTokens),
    cachedInputTokens: number(usage.cacheRead) ?? number(usage.cachedInputTokens),
    outputTokens: number(usage.output) ?? number(usage.outputTokens),
    totalTokens: number(usage.totalTokens),
  })));
  return { uncachedInputTokens: inputTokens, ...total };
}

function sumUsage(usages) {
  const sum = (key) => usages.reduce((total, usage) => total + (number(usage[key]) ?? 0), 0);
  const inputTokens = sum("inputTokens");
  const cachedInputTokens = sum("cachedInputTokens");
  const outputTokens = sum("outputTokens");
  const reportedTotal = sum("totalTokens");
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens: reportedTotal || inputTokens + outputTokens };
}

async function gradeCounter({ root }) {
  const files = await fileList(root);
  const python = files.filter((file) =>
    file.startsWith("counter/") && file.endsWith(".py") &&
    !file.split("/").some((part) => part.startsWith("test")) &&
    !file.endsWith("/__init__.py")
  );
  if (!python.length) return { success: false, grade: "No counter implementation found", rubric: {} };

  const hidden = await spawnCapture("python3", ["-c", counterGraderScript(), ...python], root, 60_000);
  let rubric = {};
  try {
    rubric = JSON.parse(hidden.stdout.trim().split("\n").at(-1) ?? "{}");
  } catch {
    return { success: false, grade: hidden.failure ?? "External counter grader returned invalid output", rubric: {} };
  }
  const completed = Object.values(rubric).filter(Boolean).length;
  const total = Object.keys(rubric).length;
  const generated = await spawnCapture("python3", ["-m", "pytest", "-q"], root, 60_000);
  return {
    success: total > 0 && completed === total,
    grade: `external ${completed}/${total}; generated tests: ${generated.failure ?? generated.stdout.trim().split("\n").at(-1) ?? "no result"}`,
    rubric,
  };
}

function gradePaperPrompt({ answer }) {
  const normalized = answer.toLowerCase().replace(/\s+/g, " ");
  const has = (...parts) => parts.every((part) => normalized.includes(part.toLowerCase()));
  const rubric = {
    distinguishesSummaryFromVerbatim: has("paper") && (
      has("not", "verbatim") || has("does not", "full prompt") || has("only", "summar") ||
      has("isn't", "printed") || has("is not", "printed")
    ),
    citesReleasedPromptSource: has("mcp-vs-cli-bench", "task_e2.py") && (
      has("v1.0.0") || has("zenodo") || has("21851992")
    ),
    identifiesArmSpecificPreambles: has("cli", "mcp") && (
      has("preamble") || has("authenticated github cli") || has("attached mcp server")
    ),
    identifiesPrivateFixtureAndBranch: has("lamb-project/aawd-e2-fixture", "fix-tokenise"),
    capturesPatchWorkflow: has("patches/fix-tokenise.py", "src/tokenise.py", "commit"),
    capturesPullRequestWorkflow: has("pull request", "main", "issue number"),
    capturesRequiredReportAndStop: has("pull request number", "file count") && (
      has("do not review or merge") || has("nothing else")
    ),
  };
  const completed = Object.values(rubric).filter(Boolean).length;
  const total = Object.keys(rubric).length;
  return {
    success: completed === total,
    grade: `external source/content rubric ${completed}/${total}`,
    rubric,
  };
}

function finalAnswerFromPi(events) {
  const messages = events
    .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
    .map((event) => event.message);
  const final = messages.at(-1);
  return (final?.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function counterGraderScript() {
  return String.raw`
import importlib.util
import json
import os
import sys
import tempfile

Counter = None
for index, relative in enumerate(sys.argv[1:]):
    try:
        spec = importlib.util.spec_from_file_location(f"candidate_{index}", relative)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if isinstance(getattr(module, "Counter", None), type):
            Counter = module.Counter
            break
    except Exception:
        pass

def make(initial=0, minimum=None):
    attempts = [(initial,)] if minimum is None else [(initial, minimum)]
    attempts += [()]
    for args in attempts:
        try:
            counter = Counter(*args)
            if not args and initial:
                if hasattr(counter, "_value"):
                    counter._value = initial
                elif hasattr(counter, "value"):
                    counter.value = initial
            return counter
        except TypeError:
            pass
    raise TypeError("Counter constructor does not accept an initial value and optional minimum")

def value(counter):
    current = getattr(counter, "value", None)
    if current is not None and not callable(current):
        return current
    getter = getattr(counter, "get_value", None)
    if callable(getter):
        return getter()
    raise AttributeError("Counter exposes no readable value")

def check(operation):
    try:
        operation()
        return True
    except Exception:
        return False

def basic():
    counter = make(3)
    counter.increment()
    assert value(counter) == 4
    counter.decrement()
    assert value(counter) == 3
    counter.reset()
    assert value(counter) == 0

def minimum():
    counter = make(5, 2)
    counter.decrement(10)
    assert value(counter) >= 2
    counter.reset()
    assert value(counter) >= 2
    assert value(make(0, 2)) >= 2

def undo():
    counter = make(5)
    counter.increment()
    counter.undo()
    assert value(counter) == 5
    counter.decrement()
    counter.undo()
    assert value(counter) == 5
    counter.reset()
    counter.undo()
    assert value(counter) == 5

def persistence():
    counter = make(7, 2)
    counter.increment()
    save = next((getattr(counter, name, None) for name in ("save", "save_to_json", "save_json") if callable(getattr(counter, name, None))), None)
    load = next((getattr(Counter, name, None) for name in ("load", "load_from_json", "load_json") if callable(getattr(Counter, name, None))), None)
    assert save and load
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "counter.json")
        save(path)
        restored = load(path)
    assert value(restored) == 8
    restored.decrement(20)
    assert value(restored) >= 2

rubric = {
    "basic_operations": bool(Counter) and check(basic),
    "minimum_value": bool(Counter) and check(minimum),
    "undo": bool(Counter) and check(undo),
    "json_save_load": bool(Counter) and check(persistence),
}
print(json.dumps(rubric, sort_keys=True))
`;
}

async function copyWorkspaceSummary(root, name) {
  const files = await fileList(root);
  const contents = [];
  let remaining = 100_000;
  for (const file of files) {
    if (remaining <= 0) {
      contents.push("[Workspace summary stopped after 100000 characters]");
      break;
    }
    const buffer = await readFile(path.join(root, file));
    if (buffer.includes(0)) {
      contents.push(`===== ${file} =====\n[Binary file: ${buffer.length} bytes]`);
      continue;
    }
    const text = buffer.toString("utf8");
    const preview = text.slice(0, Math.min(20_000, remaining));
    contents.push(`===== ${file} =====\n${preview}${preview.length < text.length ? "\n[File truncated]" : ""}`);
    remaining -= preview.length;
  }
  await writeFile(path.join(outputRoot, name), contents.join("\n"));
}

async function fileList(root) {
  const result = await spawnCapture("find", [".", "-type", "f", "-not", "-path", "*/.git/*", "-not", "-path", "*/.pytest_cache/*", "-not", "-path", "*/__pycache__/*"], root, 10_000);
  return result.stdout.split("\n").filter(Boolean).map((file) => file.replace(/^\.\//, "")).sort();
}

function spawnCapture(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      if (timeout !== undefined) clearTimeout(timeout);
      resolve({ stdout, stderr, failure: error.message });
    });
    child.on("close", (code, signal) => {
      if (timeout !== undefined) clearTimeout(timeout);
      resolve({ stdout, stderr, ...(code === 0 ? {} : { failure: signal ? `terminated by ${signal}` : `exit ${code}: ${stderr.trim()}` }) });
    });
  });
}

function number(value) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function option(name, fallback) { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback; }
