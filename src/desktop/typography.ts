export const FONT_OPTIONS = [
  {
    id: "ibm-plex-sans",
    name: "IBM Plex Sans",
    family: '"IBM Plex Sans", sans-serif',
  },
  {
    id: "ibm-plex-mono",
    name: "IBM Plex Mono",
    family: '"IBM Plex Mono", monospace',
  },
  {
    id: "pt-serif",
    name: "PT Serif",
    family: '"PT Serif", serif',
  },
  {
    id: "crimson-text",
    name: "Crimson Text",
    family: '"Crimson Text", serif',
  },
  {
    id: "crimson-pro",
    name: "Crimson Pro",
    family: '"Crimson Pro", serif',
  },
  {
    id: "cormorant-garamond",
    name: "Cormorant Garamond",
    family: '"Cormorant Garamond", serif',
  },
  {
    id: "junicode",
    name: "Junicode",
    family: '"TypoPRO Junicode", serif',
  },
  {
    id: "inter",
    name: "Inter",
    family: '"Inter", sans-serif',
  },
  {
    id: "geist",
    name: "Geist Sans",
    family: '"Geist", sans-serif',
  },
  {
    id: "geist-mono",
    name: "Geist Mono",
    family: '"Geist Mono", monospace',
  },
  {
    id: "geist-pixel",
    name: "Geist Pixel",
    family: '"Geist Pixel", monospace',
  },
  {
    id: "system-sans",
    name: "System Sans",
    family: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    id: "system-mono",
    name: "System Mono",
    family: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
] as const;

export type FontId = (typeof FONT_OPTIONS)[number]["id"];

export const DEFAULT_FONTS = {
  interface: "system-sans",
  primary: "inter",
  secondary: "ibm-plex-sans",
  code: "ibm-plex-mono",
} satisfies Record<"interface" | "primary" | "secondary" | "code", FontId>;

export const FONT_SCALE_MIN = 85;
export const FONT_SCALE_MAX = 125;
export const FONT_SCALE_STEP = 5;
export const DEFAULT_FONT_SCALE = 100;
export const CONVERSATION_FONT_BASE = 0.9;
export const DEFAULT_CODE_BLOCK_FONT_SIZE = 14;
export const DEFAULT_EDITOR_FONT_SIZE = 14;

export function fontById(id: unknown): (typeof FONT_OPTIONS)[number] | undefined {
  return FONT_OPTIONS.find((font) => font.id === id);
}

export function validFontScale(value: unknown): number | undefined {
  const scale = Number(value);
  return Number.isInteger(scale) && scale >= FONT_SCALE_MIN && scale <= FONT_SCALE_MAX
    ? scale
    : undefined;
}
