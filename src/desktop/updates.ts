import { app, ipcMain, shell } from "electron";
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";

const RELEASES_URL = "https://github.com/ptSpec/Snaffle/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/ptSpec/Snaffle/releases/latest";
const FIRST_CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000;

export type DesktopUpdateState = {
  status: "disabled" | "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";
  currentVersion: string;
  automatic: boolean;
  availableVersion?: string;
  progress?: number;
  message?: string;
};

export type DesktopUpdates = {
  start(): void;
  dispose(): void;
};

export function registerUpdateIpc(options: {
  send(state: DesktopUpdateState): void;
  canRestart(): boolean;
}): DesktopUpdates {
  const automatic = app.isPackaged && process.platform !== "darwin";
  const updater = automatic ? electronUpdater.autoUpdater as AppUpdater : null;
  let releaseUrl = RELEASES_URL;
  let state: DesktopUpdateState = {
    status: app.isPackaged ? "idle" : "disabled",
    currentVersion: app.getVersion(),
    automatic,
  };
  let firstCheck: NodeJS.Timeout | undefined;
  let checkInterval: NodeJS.Timeout | undefined;

  function update(next: DesktopUpdateState): void {
    state = next;
    options.send(state);
  }

  function withVersion(
    status: DesktopUpdateState["status"],
    info: UpdateInfo,
  ): DesktopUpdateState {
    return {
      status,
      currentVersion: app.getVersion(),
      automatic,
      availableVersion: info.version,
    };
  }

  if (updater) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.on("checking-for-update", () => update({
      status: "checking",
      currentVersion: app.getVersion(),
      automatic,
    }));
    updater.on("update-available", (info) => update(withVersion("available", info)));
    updater.on("update-not-available", () => update({
      status: "current",
      currentVersion: app.getVersion(),
      automatic,
    }));
    updater.on("download-progress", (progress: ProgressInfo) => update({
      status: "downloading",
      currentVersion: app.getVersion(),
      automatic,
      ...(state.availableVersion ? { availableVersion: state.availableVersion } : {}),
      progress: Math.round(progress.percent),
    }));
    updater.on("update-downloaded", (info) => update(withVersion("ready", info)));
    updater.on("error", (error) => update({
      status: "error",
      currentVersion: app.getVersion(),
      automatic,
      message: error.message,
    }));
  }

  async function check(): Promise<DesktopUpdateState> {
    if (!app.isPackaged || state.status === "checking" || state.status === "downloading" || state.status === "ready") {
      return state;
    }
    update({ status: "checking", currentVersion: app.getVersion(), automatic });
    try {
      if (updater) {
        await updater.checkForUpdates();
      } else {
        const release = await latestRelease();
        releaseUrl = `${RELEASES_URL}/tag/${encodeURIComponent(release.tag)}`;
        update(isNewerVersion(release.version, app.getVersion())
          ? {
              status: "available",
              currentVersion: app.getVersion(),
              automatic,
              availableVersion: release.version,
            }
          : { status: "current", currentVersion: app.getVersion(), automatic });
      }
    } catch (error) {
      update({
        status: "error",
        currentVersion: app.getVersion(),
        automatic,
        message: errorMessage(error),
      });
    }
    return state;
  }

  async function apply(): Promise<void> {
    if (!automatic && state.status === "available") {
      await shell.openExternal(releaseUrl);
      return;
    }
    if (!updater || state.status !== "ready") return;
    if (!options.canRestart()) throw new Error("Wait for active model runs to finish before updating");
    updater.quitAndInstall(false, true);
  }

  ipcMain.handle("desktop:get-update-state", () => state);
  ipcMain.handle("desktop:check-for-updates", check);
  ipcMain.handle("desktop:apply-update", apply);

  return {
    start(): void {
      if (!app.isPackaged || firstCheck) return;
      firstCheck = setTimeout(() => {
        void check();
        checkInterval = setInterval(() => void check(), CHECK_INTERVAL_MS);
        checkInterval.unref();
      }, FIRST_CHECK_DELAY_MS);
      firstCheck.unref();
    },
    dispose(): void {
      if (firstCheck) clearTimeout(firstCheck);
      if (checkInterval) clearInterval(checkInterval);
    },
  };
}

async function latestRelease(): Promise<{ tag: string; version: string }> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Snaffle/${app.getVersion()}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  const value = await response.json() as { tag_name?: unknown };
  if (typeof value.tag_name !== "string") throw new Error("Latest release has no version tag");
  const version = versionParts(value.tag_name);
  if (!version) throw new Error("Latest release has an invalid version tag");
  return { tag: value.tag_name, version: version.join(".") };
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index]! !== installed[index]!) return next[index]! > installed[index]!;
  }
  return false;
}

function versionParts(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
