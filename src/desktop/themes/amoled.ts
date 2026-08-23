import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";

export const amoledTheme = {
  ...darkTheme,
  id: "amoled",
  name: "AMOLED",
  colors: {
    ...darkTheme.colors,
    background: "#000000",
    panel: "#080808",
    surface: "#151515",
    border: "#2b2b2b",
    text: "#c0c0c0",
    "muted-text": "#787878",
    primary: "#c5c5c5",
    "primary-text": "#0c0c0c",
    "code-background": "#000000",
    "code-text": "#c4c4c4",
    "code-comment": "#878f98",
  },
} satisfies Theme;
