import { darkTheme } from "./dark.js";

export type ThemeColors = { [Name in keyof typeof darkTheme.colors]: string };

export type Theme = {
  id: string;
  name: string;
  appearance: "dark" | "light";
  colors: ThemeColors;
};

export const THEMES = [darkTheme] satisfies readonly Theme[];
export const DEFAULT_THEME = darkTheme;

export function themeById(id: string): Theme | undefined {
  return THEMES.find((theme) => theme.id === id);
}
