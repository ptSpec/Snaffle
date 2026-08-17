import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME, themeById, type Theme } from "../../../themes/index.js";

let diagramId = 0;
let renderQueue = Promise.resolve();

export function MermaidDiagram({ code, copyIcon }: { code: string; copyIcon: ReactNode }): JSX.Element {
  const themeId = useThemeId();
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setSvg("");
    setFailed(false);

    void renderDiagram(code, themeById(themeId) ?? DEFAULT_THEME).then(
      (rendered) => {
        if (active) setSvg(rendered);
      },
      () => {
        if (active) setFailed(true);
      },
    );

    return () => {
      active = false;
    };
  }, [code, themeId]);

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const sourceVisible = showSource || failed;
  return (
    <div className="code-block mermaid-block">
      <div className="code-block-actions top mermaid-block-actions">
        <span className="code-block-language">mermaid</span>
        {svg ? (
          <>
            <span className="code-block-action-separator" aria-hidden="true">/</span>
            <button
              className="mermaid-source-toggle"
              type="button"
              onClick={() => setShowSource((visible) => !visible)}
            >
              {showSource ? "Diagram" : "Source"}
            </button>
          </>
        ) : null}
        <span className="code-block-action-separator" aria-hidden="true">/</span>
        <button
          className={copied ? "copied" : ""}
          type="button"
          onClick={() => void copyCode()}
          title={copied ? "Copied" : "Copy source"}
          aria-label={copied ? "Copied" : "Copy Mermaid source"}
        >
          {copyIcon}
        </button>
      </div>
      {failed ? <div className="mermaid-error">Could not render diagram. Showing source.</div> : null}
      {sourceVisible ? (
        <pre><code>{code}</code></pre>
      ) : svg ? (
        <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="mermaid-status">Rendering diagram…</div>
      )}
    </div>
  );
}

function useThemeId(): string {
  const [themeId, setThemeId] = useState(
    () => document.documentElement.dataset.theme ?? DEFAULT_THEME.id,
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeId(document.documentElement.dataset.theme ?? DEFAULT_THEME.id);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return themeId;
}

function renderDiagram(code: string, theme: Theme): Promise<string> {
  const render = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "theme",
        "themeVariables",
        "themeCSS",
      ],
      theme: "base",
      themeVariables: mermaidTheme(theme),
    });
    const result = await mermaid.render(`snaffle-mermaid-${++diagramId}`, code);
    return result.svg;
  });

  renderQueue = render.then(() => undefined, () => undefined);
  return render;
}

function mermaidTheme(theme: Theme): Record<string, string | boolean> {
  const colors = theme.colors;
  return {
    darkMode: theme.appearance === "dark",
    background: colors.background,
    primaryColor: colors.surface,
    primaryTextColor: colors.text,
    primaryBorderColor: colors.border,
    secondaryColor: colors.panel,
    secondaryTextColor: colors.text,
    secondaryBorderColor: colors.border,
    tertiaryColor: colors["code-background"],
    tertiaryTextColor: colors["code-text"],
    tertiaryBorderColor: colors.border,
    lineColor: colors["muted-text"],
    textColor: colors.text,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-primary").trim(),
  };
}
