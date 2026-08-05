import type { Theme } from "./contract.js";
import { darkTheme } from "./dark.js";
import { eschTheme } from "./esch.js";
import { lightTheme } from "./light.js";

export { THEME_COLOR_DESCRIPTIONS } from "./contract.js";
export type { Theme, ThemeColorName, ThemeColors } from "./contract.js";

export const THEMES: readonly Theme[] = [darkTheme, lightTheme, eschTheme];
export const DEFAULT_THEME: Theme = darkTheme;

export function themeById(id: string): Theme | undefined {
  return THEMES.find((theme) => theme.id === id);
}
