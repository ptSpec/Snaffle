import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PRODUCT } from "../../identity.js";
import { App } from "./App.js";
import "./styles.css";

document.title = PRODUCT.name;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
