import { PRODUCT } from "../../identity.js";
import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";

const SNAFFLE_YELLOW = "#feff00";

export const snaffleTheme = {
  ...darkTheme,
  id: PRODUCT.slug,
  name: PRODUCT.name,
  accented: true,
  colors: {
    ...darkTheme.colors,
    primary: SNAFFLE_YELLOW,
    "primary-text": "#181818",
    brand: SNAFFLE_YELLOW,
  },
} satisfies Theme;
