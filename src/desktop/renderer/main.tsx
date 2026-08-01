import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PRODUCT } from "../../identity.js";
import { DEFAULT_THEME, themeById } from "../themes/index.js";
import { App } from "./App.js";
import "./styles.css";

document.title = PRODUCT.name;
const requestedTheme = new URLSearchParams(window.location.search).get("theme") ?? "";
const initialTheme = themeById(requestedTheme) ?? DEFAULT_THEME;
document.documentElement.dataset.theme = initialTheme.id;
document.documentElement.style.colorScheme = initialTheme.appearance;
for (const [name, value] of Object.entries(initialTheme.colors)) {
  document.documentElement.style.setProperty(`--${name}`, value);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
