import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const revision = "b00b789b17051aea61e9717458171100662318a4";
const runtimeVersion = `${revision}-snaffle-session-3`;
const sourceHash = "00dca18f0a1b251635c8f712836f641f4b0304cb6eb4859456911b707f38ea0b";
const supported = process.platform === "darwin" && ["arm64", "x64"].includes(process.arch);

if (!supported) {
  console.log(`Qwen3-ASR is not packaged for ${process.platform}-${process.arch}`);
  process.exit(0);
}

const directory = join(process.cwd(), "resources", "bin");
const executable = join(directory, "qwen_asr");
const versionFile = join(directory, ".qwen-asr-version");

try {
  if ((await readFile(versionFile, "utf8")).trim() === runtimeVersion) {
    await access(executable);
    console.log("Qwen3-ASR runtime is ready");
    process.exit(0);
  }
} catch {}

const temporary = await mkdtemp(join(tmpdir(), "snaffle-qwen-asr-"));
try {
  const response = await fetch(`https://github.com/antirez/qwen-asr/archive/${revision}.tar.gz`);
  if (!response.ok) throw new Error(`Qwen3-ASR runtime download failed (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(archive).digest("hex") !== sourceHash) {
    throw new Error("Qwen3-ASR runtime checksum did not match");
  }
  const archivePath = join(temporary, "source.tar.gz");
  await writeFile(archivePath, archive);
  await promisify(execFile)("tar", ["-xzf", archivePath, "-C", temporary]);
  const source = join(temporary, `qwen-asr-${revision}`);
  const enginePath = join(source, "qwen_asr.c");
  const engine = await readFile(enginePath, "utf8");
  const lowLatencyEngine = engine.replace(
    "ctx->stream_unfixed_chunks = 2;",
    "ctx->stream_unfixed_chunks = 0;",
  );
  if (lowLatencyEngine === engine) throw new Error("Qwen3-ASR streaming patch no longer applies");
  await writeFile(enginePath, lowLatencyEngine);
  await promisify(execFile)("patch", ["-p1", "-i", join(process.cwd(), "scripts", "qwen-asr-snaffle.patch")], { cwd: source });
  await promisify(execFile)("make", ["blas"], { cwd: source });
  await mkdir(directory, { recursive: true });
  await copyFile(join(source, "qwen_asr"), executable);
  await copyFile(join(source, "LICENSE"), join(directory, "qwen_asr.LICENSE"));
  await chmod(executable, 0o755);
  await writeFile(versionFile, `${runtimeVersion}\n`);
  console.log(`Built Qwen3-ASR runtime for ${process.platform}-${process.arch}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
