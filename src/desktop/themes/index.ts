import { LEGACY_PROJECTS } from "../../identity.js";
import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";
import { lightTheme } from "./light.js";
import { morningBrewTheme } from "./morning-brew.js";
import { snaffleTheme } from "./snaffle.js";
import { snaffleSunsetTheme } from "./snaffle-sunset.js";

export { THEME_COLOR_DESCRIPTIONS } from "./contract.js";
export type { Theme, ThemeColorName, ThemeColors } from "./contract.js";

export const THEMES: readonly Theme[] = [
  darkTheme,
  lightTheme,
  snaffleTheme,
  morningBrewTheme,
  snaffleSunsetTheme,
];
export const DEFAULT_THEME: Theme = darkTheme;

export function themeById(id: string): Theme | undefined {
  if (LEGACY_PROJECTS.some((project) => project.slug === id)) return snaffleTheme;
  return THEMES.find((theme) => theme.id === id);
}
