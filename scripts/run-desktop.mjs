import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { PROJECT } from "../dist/src/identity.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.platform === "darwin" ? await macosDevelopmentApp() : electron;
const child = spawn(executable, [root, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});

async function macosDevelopmentApp() {
  const source = path.resolve(path.dirname(electron), "../..");
  const cache = path.join(root, ".cache", "desktop");
  const bundle = path.join(cache, `${PROJECT.name}.app`);
  const contents = path.join(bundle, "Contents");
  const executableName = PROJECT.name;
  const iconName = `${PROJECT.slug}.icns`;

  await rm(bundle, { recursive: true, force: true });
  await cp(source, bundle, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    verbatimSymlinks: true,
  });
  await rename(
    path.join(contents, "MacOS", "Electron"),
    path.join(contents, "MacOS", executableName),
  );
  await cp(path.join(root, "assets", "logo.icns"), path.join(contents, "Resources", iconName));

  let plist = await readFile(path.join(source, "Contents", "Info.plist"), "utf8");
  plist = setPlistValue(plist, "CFBundleDisplayName", PROJECT.name);
  plist = setPlistValue(plist, "CFBundleExecutable", executableName);
  plist = setPlistValue(plist, "CFBundleIconFile", iconName);
  plist = setPlistValue(plist, "CFBundleIdentifier", `${PROJECT.domain.split(".").reverse().join(".")}.desktop`);
  plist = setPlistValue(plist, "CFBundleName", PROJECT.name);
  await writeFile(path.join(contents, "Info.plist"), plist);
  return path.join(contents, "MacOS", executableName);
}

function setPlistValue(plist, key, value) {
  return plist.replace(
    new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`),
    `$1${value}$2`,
  );
}
