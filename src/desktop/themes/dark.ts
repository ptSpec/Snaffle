import type { Theme } from "./contract.js";

export const darkTheme = {
  id: "dark",
  name: "Dark",
  appearance: "dark",
  colors: {
    background: "#181818",
    panel: "#2b2b2b",
    surface: "#2d2d2d",
    border: "#353535",
    text: "#e8e8e8",
    "muted-text": "#a0a0a0",
    primary: "#f2f2f2",
    "primary-text": "#181818",
    brand: "#e9e900",
    "brand-detail": "#1e1e1e",
    success: "#9cf0b7",
    warning: "#ffd19b",
    danger: "#ffb9b4",
    "code-background": "#181818",
    "code-text": "#d8d8d8",
    "code-comment": "#8b949e",
    "code-keyword": "#ff7b72",
    "code-string": "#a5d6ff",
    "code-number": "#79c0ff",
    "code-type": "#ffa657",
  },
} satisfies Theme;
