import { app, BrowserWindow } from "electron";
import path from "node:path";
import { PRODUCT } from "../identity.js";
import type { Theme } from "./themes/index.js";
import type { FontId } from "./typography.js";

export type WindowAppearance = {
  theme: Theme;
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
): BrowserWindow {
  const window = new BrowserWindow({
    title: PRODUCT.name,
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
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
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadFile(rendererPath, {
    query: {
      theme: appearance.theme.id,
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

export function applicationIcon(): string {
  const root = app.isPackaged ? process.resourcesPath : process.cwd();
  return path.join(root, "assets", "logo.png");
}
