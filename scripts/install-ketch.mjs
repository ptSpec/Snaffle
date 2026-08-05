import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const version = "0.13.0";
const targets = {
  "darwin-arm64": ["darwin_arm64.tar.gz", "19c056055e0a2109d89e86fba1fdc949b6272392c8a8cc7690bbc971a11b71fb"],
  "darwin-x64": ["darwin_x86_64.tar.gz", "35bb93dcceb5ebac433cce3c5e61a569342b0788b14a8be9b56cb999903ed428"],
  "linux-arm64": ["linux_arm64.tar.gz", "6a18b1fa94aec1471dc438ff278f807925a254529478b1c4271753ab0098b99e"],
  "linux-x64": ["linux_x86_64.tar.gz", "8077f9f6a1347cc2980d4012923c0b41d6eb5b52f023cd14602f78c0abd618ae"],
  "win32-arm64": ["windows_arm64.zip", "6764922bf43135aa11db1514b31dfaaa5ce31785cd6ed1ad8ccfa2df36f72151"],
  "win32-x64": ["windows_x86_64.zip", "8f69aa7ae96f77518c4397a0a6765abc7458aeb860ae1eb277267d0b5e6e4890"],
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

const temporary = await mkdtemp(join(tmpdir(), "esch-ketch-"));
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
  await rename(join(temporary, process.platform === "win32" ? "ketch.exe" : "ketch"), executable);
  if (process.platform !== "win32") await chmod(executable, 0o755);
  await writeFile(versionFile, `${version}\n`);
  console.log(`Installed Ketch ${version} for ${process.platform}-${process.arch}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
