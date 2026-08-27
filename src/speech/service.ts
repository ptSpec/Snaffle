import { Worker } from "node:worker_threads";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { SpeechModel, SpeechTranscriptEvent } from "./config.js";
import type { SpeechModels } from "./models.js";

type WorkerOutput =
  | { type: "ready" }
  | { type: "transcript"; event: SpeechTranscriptEvent };

const MODEL_IDLE_MS = 5 * 60_000;

export class SpeechService {
  private worker: Worker | undefined;
  private active = false;
  private keepLoaded = false;
  private idleTimer: NodeJS.Timeout | undefined;
  private onTranscript: ((event: SpeechTranscriptEvent) => void) | undefined;
  private startResult: { resolve(): void; reject(error: Error): void } | undefined;
  private stopResult: { resolve(): void; reject(error: Error): void } | undefined;

  constructor(private readonly models: SpeechModels, private readonly qwenRuntime?: string) {}

  setKeepLoaded(keepLoaded: boolean): void {
    this.keepLoaded = keepLoaded;
    if (keepLoaded) {
      this.cancelIdleUnload();
    } else if (this.worker && !this.active) {
      this.scheduleIdleUnload();
    }
  }

  async start(model: SpeechModel, language: string, onTranscript: (event: SpeechTranscriptEvent) => void): Promise<void> {
    if (this.active) throw new Error("Voice input is already active");
    const directory = this.models.directory(model);
    if (!directory) throw new Error("Download the selected speech model first");
    this.cancelIdleUnload();
    this.active = true;
    this.onTranscript = onTranscript;
    const worker = this.worker ?? this.createWorker();
    this.worker = worker;
    const ready = new Promise<void>((resolve, reject) => { this.startResult = { resolve, reject }; });
    worker.postMessage({ type: "start", model, directory, language, executable: this.qwenRuntime });
    try {
      await ready;
    } catch (error) {
      this.active = false;
      this.onTranscript = undefined;
      throw error;
    }
  }

  audio(samples: Float32Array, sampleRate: number): void {
    if (!this.active || !this.worker) return;
    const copy = new Float32Array(samples);
    this.worker.postMessage({ type: "audio", samples: copy, sampleRate }, [copy.buffer as ArrayBuffer]);
  }

  async stop(): Promise<void> {
    if (!this.active || !this.worker) return;
    const stopped = new Promise<void>((resolve, reject) => { this.stopResult = { resolve, reject }; });
    this.worker.postMessage({ type: "stop" });
    await stopped;
  }

  close(): void {
    this.cancelIdleUnload();
    void this.worker?.terminate();
    this.worker = undefined;
    this.active = false;
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
    });
    worker.on("message", (message: WorkerOutput) => {
      if (message.type === "ready") {
        this.startResult?.resolve();
        this.startResult = undefined;
        return;
      }
      this.onTranscript?.(message.event);
      if (message.event.error) {
        this.startResult?.reject(new Error(message.event.error));
        this.stopResult?.reject(new Error(message.event.error));
        this.startResult = undefined;
        this.stopResult = undefined;
        this.active = false;
        this.scheduleIdleUnload();
        return;
      }
      if (message.event.final) {
        this.stopResult?.resolve();
        this.stopResult = undefined;
        this.active = false;
        this.onTranscript = undefined;
        this.scheduleIdleUnload();
      }
    });
    worker.on("error", (error) => {
      this.startResult?.reject(error);
      this.stopResult?.reject(error);
      this.startResult = undefined;
      this.stopResult = undefined;
      this.active = false;
      this.onTranscript?.({ text: "", final: true, error: error.message });
      this.onTranscript = undefined;
      this.worker = undefined;
      this.cancelIdleUnload();
    });
    worker.on("exit", () => {
      if (this.worker === worker) this.worker = undefined;
    });
    return worker;
  }

  private scheduleIdleUnload(): void {
    this.cancelIdleUnload();
    if (this.keepLoaded || !this.worker) return;
    this.idleTimer = setTimeout(() => this.close(), MODEL_IDLE_MS);
  }

  private cancelIdleUnload(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}

export function findQwenRuntime(): string | undefined {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.QWEN_ASR_PATH,
    resources ? join(resources, "bin", "qwen_asr") : undefined,
    join(process.cwd(), "resources", "bin", "qwen_asr"),
    ...((process.env.PATH ?? "").split(delimiter).filter(Boolean).map((part) => join(part, "qwen_asr"))),
  ];
  return candidates.find((candidate) => {
    if (!candidate) return false;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
