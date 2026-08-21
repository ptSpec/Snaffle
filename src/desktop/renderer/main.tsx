import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PROJECT } from "../../identity.js";
import { DEFAULT_THEME, themeById } from "../themes/index.js";
import {
  CONVERSATION_FONT_BASE,
  DEFAULT_FONTS,
  DEFAULT_FONT_SCALE,
  fontById,
  validFontScale,
} from "../typography.js";
import { App } from "./App.js";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "@fontsource/pt-serif/latin-400.css";
import "@fontsource/pt-serif/latin-700.css";
import "@fontsource/crimson-text/latin-400.css";
import "@fontsource/crimson-text/latin-600.css";
import "@fontsource/crimson-text/latin-700.css";
import "@fontsource/crimson-pro/latin-400.css";
import "@fontsource/crimson-pro/latin-500.css";
import "@fontsource/crimson-pro/latin-600.css";
import "@fontsource/crimson-pro/latin-700.css";
import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/cormorant-garamond/latin-700.css";
import "@typopro/web-junicode/TypoPRO-Junicode-Regular.css";
import "@typopro/web-junicode/TypoPRO-Junicode-Italic.css";
import "@typopro/web-junicode/TypoPRO-Junicode-Bold.css";
import "@typopro/web-junicode/TypoPRO-Junicode-BoldItalic.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist/latin-700.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "@fontsource/geist-mono/latin-600.css";
import "@fontsource/geist-mono/latin-700.css";
import "@fontsource/geist-pixel/latin-400.css";
import "./styles.css";

document.title = PROJECT.name;
const query = new URLSearchParams(window.location.search);
const requestedTheme = query.get("theme") ?? "";
const initialTheme = themeById(requestedTheme) ?? DEFAULT_THEME;
document.documentElement.dataset.theme = initialTheme.id;
document.documentElement.dataset.animations = query.get("animations") === "off" ? "off" : "on";
document.documentElement.dataset.appearance = initialTheme.appearance;
document.documentElement.dataset.accentedTheme = String(Boolean(initialTheme.accented));
document.documentElement.style.colorScheme = initialTheme.appearance;
for (const [name, value] of Object.entries(initialTheme.colors)) {
  document.documentElement.style.setProperty(`--${name}`, value);
}
for (const role of ["interface", "primary", "secondary", "code"] as const) {
  const id = fontById(query.get(`${role}Font`))?.id ?? DEFAULT_FONTS[role];
  document.documentElement.dataset[`${role}Font`] = id;
  document.documentElement.style.setProperty(`--font-${role}`, fontById(id)!.family);
}
for (const role of ["interface", "conversation"] as const) {
  const scale = validFontScale(query.get(`${role}FontScale`)) ?? DEFAULT_FONT_SCALE;
  document.documentElement.dataset[`${role}FontScale`] = String(scale);
  const baseline = role === "conversation" ? CONVERSATION_FONT_BASE : 1;
  document.documentElement.style.setProperty(`--${role}-font-scale`, String(scale / 100 * baseline));
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
