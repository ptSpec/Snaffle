export const THEME_COLOR_DESCRIPTIONS = {
  "app-background": "Main conversation canvas and native window background.",
  "sidebar-background": "Workspace and thread sidebar background.",
  "inspector-background": "Contextual inspector background.",
  "composer-background": "Message composer background.",
  "card-background": "Tool call and other raised card backgrounds.",
  "hover-background": "Background of an interactive item while hovered.",
  "selected-background": "Background of a selected interactive item.",
  "control-background": "Background of a secondary filled control.",
  "border-default": "Quiet divider and control border.",
  "border-focus": "Visible focus, resize, and emphasized border.",
  "text-primary": "Normal readable text.",
  "text-strong": "Headings and highest-emphasis text.",
  "text-secondary": "Supporting text that remains clearly readable.",
  "text-muted": "Metadata and lower-priority labels.",
  "text-faint": "Lowest-priority labels and inactive icons.",
  "link-text": "Clickable web links in rendered Markdown.",
  "brand-mark-base": "Main fill of the Esch lettermark.",
  "brand-mark-detail": "Pattern drawn inside the Esch lettermark.",
  accent: "Primary action background.",
  "accent-contrast": "Text or icon drawn on the accent color.",
  "status-info-text": "Text for active or informational status.",
  "status-info-background": "Background for active or informational status.",
  "status-success-text": "Text for successful status.",
  "status-success-background": "Background for successful status.",
  "status-warning-text": "Text for warning or nonzero command status.",
  "status-warning-background": "Background for warning or nonzero command status.",
  "status-danger-text": "Text for errors and failed status.",
  "status-danger-background": "Background for compact error status.",
  "thinking-orb-blue": "Blue fluid color in the active thinking indicator.",
  "thinking-orb-red": "Red fluid color in the active thinking indicator.",
  "message-danger-background": "Background for a full error message.",
  "unsafe-text": "Text indicating unsafe host execution.",
  "unsafe-indicator": "Indicator showing unsafe host execution is enabled.",
  "code-background": "Background of code and command output blocks.",
  "code-text": "Default text in code and command output blocks.",
  "syntax-comment": "Syntax-highlighted comments.",
  "syntax-keyword": "Syntax-highlighted language keywords.",
  "syntax-string": "Syntax-highlighted strings.",
  "syntax-number": "Syntax-highlighted numbers.",
  "syntax-function": "Syntax-highlighted function names.",
  "syntax-type": "Syntax-highlighted type names.",
  "syntax-operator": "Syntax-highlighted operators and punctuation.",
  "editor-selection-background": "Selection highlight inside the code editor.",
  "editor-cursor": "Insertion cursor inside the code editor.",
  "diff-added-text": "Text of added lines in a Git diff.",
  "diff-added-background": "Background of added lines in a Git diff.",
  "diff-removed-text": "Text of removed lines in a Git diff.",
  "diff-removed-background": "Background of removed lines in a Git diff.",
  "diff-modified-text": "Text highlighting a modified region in a Git diff.",
  "diff-modified-background": "Background highlighting a modified region in a Git diff.",
} as const;

export type ThemeColorName = keyof typeof THEME_COLOR_DESCRIPTIONS;
export type ThemeColors = Record<ThemeColorName, string>;

export type Theme = {
  id: string;
  name: string;
  appearance: "dark" | "light";
  colors: ThemeColors;
};
