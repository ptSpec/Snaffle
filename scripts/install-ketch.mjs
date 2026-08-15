import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const version = "0.14.0";
const targets = {
  "darwin-arm64": ["darwin_arm64.tar.gz", "7da541c2953ec9899345532a839eae81dca85ba613bf2139befd156aa4debc36"],
  "darwin-x64": ["darwin_x86_64.tar.gz", "c1a0d2539274bc30b0f04a56c9d81e62a535260197cd4e3f2c428fb71d0e0ed6"],
  "linux-arm64": ["linux_arm64.tar.gz", "501bdfb630cabfe714121397af02f77efb73c8053b165380c96b36647e0ea44e"],
  "linux-x64": ["linux_x86_64.tar.gz", "5d8d3ee8149b417b34631fc9987880d45823cf5622af8d7b43910d0a86c4a815"],
  "win32-arm64": ["windows_arm64.zip", "0e4be9b98eafdc6b3289c97688ffac6e2e787de2161d0e3f2e7da73e0c017024"],
  "win32-x64": ["windows_x86_64.zip", "7b93f5313bb6fbe9a945a57fa014333f3427dc5c04d7f4f7503bcc80b04bf9d7"],
};

const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error(`Ketch is unavailable for ${process.platform}-${process.arch}`);

const [suffix, expectedHash] = target;
const directory = join(process.cwd(), "resources", "bin");
const executable = join(directory, process.platform === "win32" ? "ketch.exe" : "ketch");
const versionFile = join(directory, ".ketch-version");

try {
  if ((await readFile(versionFile, "utf8")).trim() === version) {
    await access(executable);
    console.log(`Ketch ${version} is ready`);
    process.exit(0);
  }
} catch {}

const temporary = await mkdtemp(join(tmpdir(), "coding-harness-ketch-"));
try {
  const archiveName = `ketch_${version}_${suffix}`;
  const response = await fetch(`https://github.com/1broseidon/ketch/releases/download/v${version}/${archiveName}`);
  if (!response.ok) throw new Error(`Ketch download failed (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash("sha256").update(archive).digest("hex");
  if (actualHash !== expectedHash) throw new Error("Ketch download checksum did not match");

  const archivePath = join(temporary, archiveName);
  await writeFile(archivePath, archive);
  await promisify(execFile)("tar", ["-xf", archivePath, "-C", temporary]);
  await mkdir(directory, { recursive: true });
  await rm(executable, { force: true });
  await copyFile(join(temporary, process.platform === "win32" ? "ketch.exe" : "ketch"), executable);
  if (process.platform !== "win32") await chmod(executable, 0o755);
  await writeFile(versionFile, `${version}\n`);
  console.log(`Installed Ketch ${version} for ${process.platform}-${process.arch}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
