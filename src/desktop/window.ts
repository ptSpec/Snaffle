import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { PROJECT } from "../identity.js";
import type { Theme } from "./themes/index.js";
import type { FontId } from "./typography.js";

export type WindowAppearance = {
  theme: Theme;
  animationsEnabled: boolean;
  interfaceFont: FontId;
  primaryFont: FontId;
  secondaryFont: FontId;
  codeFont: FontId;
  interfaceFontScale: number;
  conversationFontScale: number;
};

export function createDesktopWindow(
  rendererPath: string,
  preloadPath: string,
  appearance: WindowAppearance,
  development: boolean,
): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const preferredHeight = process.platform === "win32" ? 960 : 860;
  const window = new BrowserWindow({
    title: PROJECT.name,
    width: Math.min(1360, workArea.width),
    height: Math.min(preferredHeight, workArea.height),
    minWidth: Math.min(980, workArea.width),
    minHeight: Math.min(640, workArea.height),
    ...(process.platform === "darwin" ? {} : { icon: applicationIcon() }),
    backgroundColor: appearance.theme.colors.background,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 12, y: 14 } }
      : {
          titleBarOverlay: {
            color: appearance.theme.colors.background,
            symbolColor: appearance.theme.colors.text,
            height: 40,
          },
        }),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      devTools: development,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    webContents?.id === window.webContents.id && permission === "media" && details.mediaType === "audio"
  );
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(
      webContents.id === window.webContents.id &&
      permission === "media" &&
      mediaTypes?.length === 1 &&
      mediaTypes[0] === "audio",
    );
  });
  window.webContents.on("did-finish-load", () => {
    window.webContents.setZoomLevel(0);
  });
  void window.loadFile(rendererPath, {
    query: {
      theme: appearance.theme.id,
      animations: appearance.animationsEnabled ? "on" : "off",
      interfaceFont: appearance.interfaceFont,
      primaryFont: appearance.primaryFont,
      secondaryFont: appearance.secondaryFont,
      codeFont: appearance.codeFont,
      interfaceFontScale: String(appearance.interfaceFontScale),
      conversationFontScale: String(appearance.conversationFontScale),
    },
  });
  return window;
}

export function applicationIcon(development = !app.isPackaged): string {
  const root = development ? process.cwd() : process.resourcesPath;
  return path.join(root, "assets", "logo.png");
}
