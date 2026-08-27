import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  SPEECH_MODELS,
  type SpeechModel,
  type SpeechModelStatus,
} from "./config.js";

type ModelPackage = {
  directory: string;
  files: string[];
  legacyDirectories?: string[];
} & ({
  url: string;
  bytes: number;
  sha256: string;
} | {
  downloads: Array<{ name: string; bytes: number; sha256: string }>;
});

const PACKAGES: Partial<Record<SpeechModel, ModelPackage>> = {
  "parakeet-tdt-0.6b-v3": {
    directory: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    bytes: 487_170_055,
    sha256: "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf",
    files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
  },
  "nemotron-3.5-asr-streaming-0.6b": {
    directory: "sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25",
    legacyDirectories: ["sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11"],
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25.tar.bz2",
    bytes: 463_945_051,
    sha256: "78e2b79fcf7271553a74402a76b771b09ea40117a39566a79f52235b23db6358",
    files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
  },
  "qwen3-asr-1.7b": {
    directory: "qwen3-asr-1.7b",
    files: [
      "config.json",
      "generation_config.json",
      "merges.txt",
      "model.safetensors.index.json",
      "model-00001-of-00002.safetensors",
      "model-00002-of-00002.safetensors",
      "vocab.json",
    ],
    downloads: [
      { name: "config.json", bytes: 6_194, sha256: "2e74a751548b8ad7d7526d29365ad8144c345d8b412b1152d25dc6698452712f" },
      { name: "generation_config.json", bytes: 142, sha256: "1da527824d81e07118facff437e03f2e24a23311e3bdeb2368973fe77e5f275c" },
      { name: "merges.txt", bytes: 1_671_853, sha256: "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5" },
      { name: "model.safetensors.index.json", bytes: 64_821, sha256: "f994739fe38e5210b9e3e8ce6c6307315e2ceac3cb630e7b7414d69dce520f60" },
      { name: "model-00001-of-00002.safetensors", bytes: 4_220_320_824, sha256: "a4cd1f1a04d90b757dc7f7dd26254e69a013b19e80efe590a83c6a3bde8608d6" },
      { name: "model-00002-of-00002.safetensors", bytes: 478_200_688, sha256: "6e0b9d9e09e2e0238e7ef3cc8a484ab387e91b90f1900bedf88bc92d7929ccfc" },
      { name: "vocab.json", bytes: 2_776_833, sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910" },
    ],
  },
};

const QWEN_REVISION = "7278e1e70fe206f11671096ffdd38061171dd6e5";

export class SpeechModels {
  private readonly active = new Map<SpeechModel, SpeechModelStatus>();

  constructor(
    private readonly root: string,
    private readonly onStatus: (status: SpeechModelStatus) => void,
    private readonly qwenRuntime?: string,
  ) {}

  list(): SpeechModelStatus[] {
    return SPEECH_MODELS.map(({ id }) => this.status(id));
  }

  directory(id: SpeechModel): string | undefined {
    const model = PACKAGES[id];
    if (!model || !this.installed(model)) return undefined;
    return path.join(this.root, model.directory);
  }

  async install(id: SpeechModel): Promise<void> {
    const model = PACKAGES[id];
    if (!model) throw new Error("The selected speech model is unavailable");
    if (id === "qwen3-asr-1.7b" && !this.qwenRuntime) {
      throw new Error("Qwen3-ASR 1.7B is not available on this computer");
    }
    if (this.active.has(id)) return;
    mkdirSync(this.root, { recursive: true });
    const token = randomUUID();
    const archive = path.join(this.root, `${token}.tar.bz2`);
    const extractRoot = path.join(this.root, `${token}.extracting`);
    try {
      if ("downloads" in model) {
        const directory = path.join(extractRoot, model.directory);
        mkdirSync(directory, { recursive: true });
        const total = model.downloads.reduce((sum, file) => sum + file.bytes, 0);
        let received = 0;
        for (const file of model.downloads) {
          const url = `https://huggingface.co/Qwen/Qwen3-ASR-1.7B/resolve/${QWEN_REVISION}/${file.name}`;
          await this.download(id, url, file.bytes, file.sha256, path.join(directory, file.name), received, total);
          received += file.bytes;
        }
      } else {
        await this.download(id, model.url, model.bytes, model.sha256, archive, 0, model.bytes);
      }
      this.update(id, "installing", 1, "Finalizing…");
      if ("url" in model) {
        mkdirSync(extractRoot, { recursive: true });
        await extractArchive(archive, extractRoot);
      }
      const extracted = path.join(extractRoot, model.directory);
      if (!model.files.every((file) => existsSync(path.join(extracted, file)))) {
        throw new Error("Downloaded model is missing required files");
      }
      const destination = path.join(this.root, model.directory);
      rmSync(destination, { recursive: true, force: true });
      renameSync(extracted, destination);
      model.legacyDirectories?.forEach((directory) => {
        rmSync(path.join(this.root, directory), { recursive: true, force: true });
      });
      this.active.delete(id);
      this.onStatus(this.status(id));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.update(id, "error", 0, detail);
      this.active.delete(id);
      throw error;
    } finally {
      rmSync(archive, { force: true });
      rmSync(extractRoot, { recursive: true, force: true });
    }
  }

  remove(id: SpeechModel): void {
    if (this.active.has(id)) throw new Error("Wait for the model installation to finish");
    const model = PACKAGES[id];
    if (!model) return;
    rmSync(path.join(this.root, model.directory), { recursive: true, force: true });
    model.legacyDirectories?.forEach((directory) => {
      rmSync(path.join(this.root, directory), { recursive: true, force: true });
    });
    this.onStatus(this.status(id));
  }

  private status(id: SpeechModel): SpeechModelStatus {
    const active = this.active.get(id);
    if (active) return active;
    const model = PACKAGES[id];
    if (!model || (id === "qwen3-asr-1.7b" && !this.qwenRuntime)) {
      return { id, phase: "unavailable", progress: 0, detail: "Not available on this computer" };
    }
    return this.installed(model)
      ? { id, phase: "ready", progress: 1, detail: "Ready" }
      : { id, phase: "missing", progress: 0, detail: "Not downloaded" };
  }

  private installed(model: ModelPackage): boolean {
    const directory = path.join(this.root, model.directory);
    return model.files.every((file) => existsSync(path.join(directory, file)));
  }

  private update(id: SpeechModel, phase: SpeechModelStatus["phase"], progress: number, detail: string): void {
    const status = { id, phase, progress, detail };
    this.active.set(id, status);
    this.onStatus(status);
  }

  private async download(
    id: SpeechModel,
    url: string,
    bytes: number,
    sha256: string,
    destination: string,
    previousBytes: number,
    totalBytes: number,
  ): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`);
    const output = createWriteStream(destination, { flags: "wx" });
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let received = 0;
    let lastUpdate = 0;
    this.update(id, "downloading", 0, "Downloading…");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      hash.update(value);
      if (!output.write(value)) await once(output, "drain");
      const now = Date.now();
      if (now - lastUpdate >= 200 || received >= bytes) {
        lastUpdate = now;
        const totalReceived = previousBytes + received;
        this.update(id, "downloading", Math.min(1, totalReceived / totalBytes), `${formatSize(totalReceived)} of ${formatSize(totalBytes)}`);
      }
    }
    output.end();
    await once(output, "finish");
    if (hash.digest("hex") !== sha256) throw new Error("Model checksum did not match");
  }
}

async function extractArchive(archive: string, destination: string): Promise<void> {
  const child = spawn("tar", ["-xjf", archive, "-C", destination], { stdio: ["ignore", "ignore", "pipe"] });
  let error = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { error += chunk; });
  const [code] = await once(child, "close") as [number | null];
  if (code !== 0) throw new Error(error.trim() || "Could not extract the model archive");
}

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}
