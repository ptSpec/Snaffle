import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import "./editor.css";

export default function GitEditor({
  path,
  current,
  original,
  onChange,
  onSave,
}: {
  path: string;
  current: string;
  original: string;
  onChange(value: string): void;
  onSave(): void;
}): JSX.Element {
  const parent = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    let view: EditorView | undefined;
    let cancelled = false;

    void languageForPath(path).then((language) => {
      if (cancelled || !parent.current) return;
      view = new EditorView({
        parent: parent.current,
        state: EditorState.create({
          doc: current,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            highlightActiveLine(),
            syntaxHighlighting(eschHighlighting),
            keymap.of([
              { key: "Mod-s", run: () => { handlers.current.onSave(); return true; } },
              indentWithTab,
              ...defaultKeymap,
              ...historyKeymap,
            ]),
            unifiedMergeView({
              original,
              gutter: true,
              highlightChanges: false,
              mergeControls: false,
              allowInlineDiffs: true,
              collapseUnchanged: { margin: 3, minSize: 6 },
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
            }),
            editorTheme,
            language,
          ],
        }),
      });
    });

    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [current, original, path]);

  return <div className="git-editor" ref={parent} />;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--code-text)",
    backgroundColor: "var(--code-background)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-code)",
    fontSize: "var(--editor-font-size, 13px)",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "7px 0", caretColor: "var(--text-strong)" },
  ".cm-line": { padding: "0 7px 0 4px" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--editor-selection-background) 72%, transparent) !important",
  },
  ".cm-selectionLayer": { zIndex: "4 !important", pointerEvents: "none" },
  ".cm-cursorLayer": { zIndex: "5 !important" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--editor-cursor) !important",
    borderLeftWidth: "2px",
    boxShadow: "0 0 3px var(--editor-cursor)",
  },
  ".cm-gutters": {
    color: "var(--text-faint)",
    backgroundColor: "var(--code-background)",
    border: "0",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover-background)" },
  "&.cm-merge-b .cm-changedLine": {
    backgroundColor: "color-mix(in srgb, var(--diff-added-text) 16%, var(--code-background))",
  },
  ".cm-deletedChunk": {
    backgroundColor: "color-mix(in srgb, var(--diff-removed-text) 16%, var(--code-background))",
  },
  ".cm-deletedChunk, .cm-deletedChunk *": { userSelect: "text" },
  ".cm-deletedChunk ::selection": { backgroundColor: "var(--editor-selection-background)" },
  "&.cm-merge-b .cm-changedLineGutter": { background: "var(--diff-added-text)" },
  ".cm-deletedLineGutter": { background: "var(--diff-removed-text)" },
  ".cm-collapsedLines": {
    color: "var(--text-muted)",
    background: "color-mix(in srgb, var(--text-faint) 12%, var(--code-background))",
  },
});

const eschHighlighting = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: [tags.keyword, tags.modifier], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
  { tag: tags.function(tags.variableName), color: "var(--syntax-function)" },
  { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--syntax-operator)" },
]);

async function languageForPath(filePath: string): Promise<Extension> {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs"].includes(extension ?? "")) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/javascript")).javascript);
  }
  if (["ts", "tsx", "mts", "cts"].includes(extension ?? "")) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/javascript")).typescript);
  }
  if (extension === "json") {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/javascript")).json);
  }
  if (extension === "py") return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/python")).python);
  if (["sh", "bash", "zsh"].includes(extension ?? "")) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell);
  }
  if (["css", "scss", "less"].includes(extension ?? "")) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/css")).css);
  }
  if (["html", "htm", "xml", "svg"].includes(extension ?? "")) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/xml")).html);
  }
  if (["yaml", "yml"].includes(extension ?? "")) {
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/yaml")).yaml);
  }
  if (extension === "rs") return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/rust")).rust);
  if (extension === "go") return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/go")).go);
  if (["c", "h", "cc", "cpp", "cxx", "hpp", "java", "cs", "kt", "kts", "dart"].includes(extension ?? "")) {
    const mode = await import("@codemirror/legacy-modes/mode/clike");
    if (extension === "java") return StreamLanguage.define(mode.java);
    if (extension === "cs") return StreamLanguage.define(mode.csharp);
    if (extension === "kt" || extension === "kts") return StreamLanguage.define(mode.kotlin);
    if (extension === "dart") return StreamLanguage.define(mode.dart);
    return StreamLanguage.define(extension === "c" || extension === "h" ? mode.c : mode.cpp);
  }
  return [];
}
