export const THEME_COLOR_DESCRIPTIONS = {
  background: "Main application and conversation background.",
  panel: "Sidebar and inspector background.",
  surface: "Composer and raised control background.",
  border: "Dividers and quiet control borders.",
  text: "Normal readable text and headings.",
  "muted-text": "Supporting labels, metadata, and inactive icons.",
  primary: "Primary actions, focus, links, and key code highlights.",
  "primary-text": "Text or icons drawn on the primary color.",
  brand: "Main fill of the project mark.",
  "brand-detail": "Pattern drawn inside the project mark.",
  success: "Successful state and added Git content.",
  warning: "Warning state and modified Git content.",
  danger: "Failure state and removed Git content.",
  "code-background": "Shared background for code blocks and the editor.",
  "code-text": "Default code text and operators.",
  "code-comment": "Syntax-highlighted comments.",
  "code-keyword": "Syntax-highlighted language keywords.",
  "code-string": "Syntax-highlighted strings.",
  "code-number": "Syntax-highlighted numbers and literals.",
  "code-function": "Syntax-highlighted function and method names.",
  "code-type": "Syntax-highlighted types and classes.",
  "code-tag": "Syntax-highlighted markup tags and attributes.",
} as const;

export type ThemeColorName = keyof typeof THEME_COLOR_DESCRIPTIONS;
export type ThemeColors = Record<ThemeColorName, string>;

export type Theme = {
  id: string;
  name: string;
  appearance: "dark" | "light";
  accented?: boolean;
  colors: ThemeColors;
};
