import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";

const ESCH_YELLOW = "#feff00";

export const eschTheme = {
  ...darkTheme,
  id: "esch",
  name: "Esch",
  accented: true,
  colors: {
    ...darkTheme.colors,
    primary: ESCH_YELLOW,
    "primary-text": "#181818",
    brand: ESCH_YELLOW,
  },
} satisfies Theme;
