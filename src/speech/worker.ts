import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { SpeechModel, SpeechTranscriptEvent } from "./config.js";

type Stream = {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
  inputFinished(): void;
};

type OnlineRecognizer = {
  createStream(): Stream;
  isReady(stream: Stream): boolean;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text: string };
  isEndpoint(stream: Stream): boolean;
  reset(stream: Stream): void;
};

type OfflineRecognizer = {
  createStream(): Stream;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text: string };
};

type Sherpa = {
  OnlineRecognizer: new (config: unknown) => OnlineRecognizer;
  OfflineRecognizer: new (config: unknown) => OfflineRecognizer;
};

type WorkerInput =
  | { type: "start"; model: SpeechModel; directory: string; language: string; executable?: string }
  | { type: "audio"; samples: Float32Array; sampleRate: number }
  | { type: "stop" };

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node") as Sherpa;
const port = parentPort;
if (!port) throw new Error("Speech worker requires a parent port");

const QWEN_FINAL_MARKER = "\n\u001eSNAFFLE_FINAL\n";

let model: SpeechModel | undefined;
let modelDirectory = "";
let modelLanguage = "";
let onlineRecognizer: OnlineRecognizer | undefined;
let onlineStream: Stream | undefined;
let offlineRecognizer: OfflineRecognizer | undefined;
let samples: Float32Array[] = [];
let sampleCount = 0;
let lastDecode = 0;
let committed = "";
let inputSampleRate = 16_000;
let lastSent = "";
let qwenProcess: ChildProcessWithoutNullStreams | undefined;
let qwenOutput = "";
let qwenError = "";

port.on("message", (message: WorkerInput) => {
  try {
    if (message.type === "start") start(message);
    else if (message.type === "audio") acceptAudio(message.samples, message.sampleRate);
    else stop();
  } catch (error) {
    send({ text: "", final: true, error: error instanceof Error ? error.message : String(error) });
  }
});

function start(message: Extract<WorkerInput, { type: "start" }>): void {
  const reusable = model === message.model && modelDirectory === message.directory && modelLanguage === message.language;
  model = message.model;
  modelDirectory = message.directory;
  modelLanguage = message.language;
  samples = [];
  sampleCount = 0;
  lastDecode = 0;
  committed = "";
  lastSent = "";
  onlineStream = undefined;
  qwenOutput = "";
  qwenError = "";
  const files = modelFiles(message.directory);
  if (model === "nemotron-3.5-asr-streaming-0.6b") {
    if (!reusable || !onlineRecognizer) {
      releaseLoadedModel();
      onlineRecognizer = new sherpa.OnlineRecognizer({
        featConfig: { sampleRate: 16_000, featureDim: 80 },
        modelConfig: {
          transducer: files,
          tokens: path.join(message.directory, "tokens.txt"),
          numThreads: 2,
          provider: "cpu",
        },
        decodingMethod: "greedy_search",
        enableEndpoint: true,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      });
    }
    onlineStream = onlineRecognizer.createStream();
  } else if (model === "parakeet-tdt-0.6b-v3") {
    if (!reusable || !offlineRecognizer) {
      releaseLoadedModel();
      offlineRecognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: 16_000, featureDim: 80 },
        modelConfig: {
          transducer: files,
          tokens: path.join(message.directory, "tokens.txt"),
          numThreads: 2,
          provider: "cpu",
          modelType: "nemo_transducer",
        },
        decodingMethod: "greedy_search",
      });
    }
  } else if (model === "qwen3-asr-1.7b" && message.executable) {
    if (reusable && qwenProcess) {
      port!.postMessage({ type: "ready" });
      return;
    }
    releaseLoadedModel();
    const args = ["-d", message.directory, "--stdin", "--stream", "--snaffle-server"];
    if (message.language !== "auto") args.push("--language", message.language);
    const child = spawn(message.executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    qwenProcess = child;
    let readySent = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      qwenOutput += chunk;
      const boundary = qwenOutput.indexOf(QWEN_FINAL_MARKER);
      if (boundary >= 0) {
        send({ text: clean(qwenOutput.slice(0, boundary)), final: true });
        qwenOutput = qwenOutput.slice(boundary + QWEN_FINAL_MARKER.length);
      } else {
        send({ text: clean(qwenOutput), final: false });
      }
    });
    child.stderr.on("data", (chunk: string) => {
      qwenError = `${qwenError}${chunk}`.slice(-4_000);
      if (!readySent && qwenError.includes("Model loaded.")) {
        readySent = true;
        port!.postMessage({ type: "ready" });
      }
    });
    child.once("error", (error) => send({ text: "", final: true, error: error.message }));
    child.once("close", (code) => {
      if (qwenProcess !== child) return;
      qwenProcess = undefined;
      if (code !== 0) send({ text: "", final: true, error: qwenError.trim() || `Qwen3-ASR stopped (${code ?? "unknown"})` });
    });
    return;
  } else {
    throw new Error("The selected speech model does not have a desktop runtime adapter");
  }
  port!.postMessage({ type: "ready" });
}

function acceptAudio(chunk: Float32Array, sampleRate: number): void {
  inputSampleRate = sampleRate;
  if (qwenProcess) {
    const audio = resample16k(chunk, sampleRate);
    const pcm = Buffer.allocUnsafe(audio.length * 2);
    for (let index = 0; index < audio.length; index += 1) {
      const value = Math.max(-1, Math.min(1, audio[index]!));
      pcm.writeInt16LE(Math.round(value < 0 ? value * 32_768 : value * 32_767), index * 2);
    }
    writeQwenFrame(qwenProcess, 1, pcm);
    return;
  }
  if (onlineRecognizer && onlineStream) {
    onlineStream.acceptWaveform({ samples: chunk, sampleRate });
    while (onlineRecognizer.isReady(onlineStream)) onlineRecognizer.decode(onlineStream);
    const partial = clean(onlineRecognizer.getResult(onlineStream).text);
    send({ text: join(committed, partial), final: false });
    if (onlineRecognizer.isEndpoint(onlineStream)) {
      committed = join(committed, partial);
      onlineRecognizer.reset(onlineStream);
    }
    return;
  }
  if (!offlineRecognizer) throw new Error("Speech recognition has not started");
  samples.push(chunk);
  sampleCount += chunk.length;
  if (sampleCount - lastDecode >= sampleRate * 1.6) {
    lastDecode = sampleCount;
    send({ text: decodeOffline(sampleRate), final: false });
  }
}

function stop(): void {
  if (qwenProcess) {
    writeQwenFrame(qwenProcess, 2);
    return;
  }
  if (onlineRecognizer && onlineStream) {
    onlineStream.inputFinished();
    while (onlineRecognizer.isReady(onlineStream)) onlineRecognizer.decode(onlineStream);
    const text = join(committed, clean(onlineRecognizer.getResult(onlineStream).text));
    send({ text, final: true });
  } else if (offlineRecognizer) {
    send({ text: decodeOffline(inputSampleRate), final: true });
  } else {
    send({ text: "", final: true });
  }
  onlineStream = undefined;
  samples = [];
  sampleCount = 0;
}

function writeQwenFrame(child: ChildProcessWithoutNullStreams, type: number, payload?: Buffer): void {
  const header = Buffer.allocUnsafe(5);
  header[0] = type;
  header.writeUInt32LE(payload?.length ?? 0, 1);
  child.stdin.write(header);
  if (payload?.length) child.stdin.write(payload);
}

function releaseLoadedModel(): void {
  onlineRecognizer = undefined;
  onlineStream = undefined;
  offlineRecognizer = undefined;
  if (qwenProcess) {
    const child = qwenProcess;
    qwenProcess = undefined;
    child.kill();
  }
}

process.on("exit", releaseLoadedModel);

function resample16k(input: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 16_000) return input;
  const output = new Float32Array(Math.floor(input.length * 16_000 / sampleRate));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = input[Math.floor(index * sampleRate / 16_000)]!;
  }
  return output;
}

function decodeOffline(sampleRate: number): string {
  if (!offlineRecognizer || sampleCount === 0) return "";
  const audio = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of samples) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  const stream = offlineRecognizer.createStream();
  stream.acceptWaveform({ samples: audio, sampleRate });
  offlineRecognizer.decode(stream);
  return clean(offlineRecognizer.getResult(stream).text);
}

function modelFiles(directory: string): { encoder: string; decoder: string; joiner: string } {
  return {
    encoder: path.join(directory, "encoder.int8.onnx"),
    decoder: path.join(directory, "decoder.int8.onnx"),
    joiner: path.join(directory, "joiner.int8.onnx"),
  };
}

function clean(text: string): string {
  return text.replace(/^<[^>]+>\s*/, "").trim();
}

function join(left: string, right: string): string {
  return [left.trim(), right.trim()].filter(Boolean).join(" ");
}

function send(event: SpeechTranscriptEvent): void {
  if (!event.final && !event.error && event.text === lastSent) return;
  lastSent = event.text;
  port!.postMessage({ type: "transcript", event });
}
