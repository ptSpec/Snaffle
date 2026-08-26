import { PROJECT } from "../../identity.js";
import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";

const SNAFFLE_YELLOW = "#cbcb12";
const SNAFFLE_BACKGROUND = "#1e1f22";
const SNAFFLE_PANEL = "#27282b";

export const snaffleTheme = {
  ...darkTheme,
  id: PROJECT.slug,
  name: PROJECT.name,
  accented: true,
  colors: {
    ...darkTheme.colors,
    background: SNAFFLE_BACKGROUND,
    panel: SNAFFLE_PANEL,
    surface: SNAFFLE_PANEL,
    border: "#37383b",
    primary: SNAFFLE_YELLOW,
    "primary-text": SNAFFLE_BACKGROUND,
    brand: SNAFFLE_YELLOW,
    "brand-detail": SNAFFLE_BACKGROUND,
    "code-background": SNAFFLE_BACKGROUND,
    "code-keyword": "#FE5150",
    "code-number": "#41AAFC",
    "code-function": SNAFFLE_YELLOW,
    "code-type": "#1DA689",
  },
} satisfies Theme;
