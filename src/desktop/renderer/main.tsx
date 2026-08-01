import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PRODUCT } from "../../identity.js";
import { DEFAULT_THEME } from "../themes/index.js";
import { App } from "./App.js";
import "./styles.css";

document.title = PRODUCT.name;
document.documentElement.dataset.theme = DEFAULT_THEME.id;
document.documentElement.style.colorScheme = DEFAULT_THEME.appearance;
for (const [name, value] of Object.entries(DEFAULT_THEME.colors)) {
  document.documentElement.style.setProperty(`--${name}`, value);
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
