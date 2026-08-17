import { PROJECT } from "../../identity.js";
import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";

const SNAFFLE_YELLOW = "#feff00";

export const snaffleTheme = {
  ...darkTheme,
  id: PROJECT.slug,
  name: PROJECT.name,
  accented: true,
  colors: {
    ...darkTheme.colors,
    panel: "#2b2b2b",
    primary: SNAFFLE_YELLOW,
    "primary-text": "#181818",
    brand: SNAFFLE_YELLOW,
  },
} satisfies Theme;
