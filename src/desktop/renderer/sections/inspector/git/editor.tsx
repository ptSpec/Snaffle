import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { getChunks, getOriginalDoc, unifiedMergeView, type Chunk } from "@codemirror/merge";
import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import "./editor.css";

export type GitEditorHandle = { value(): string };
export type GitCodeSelection = {
  fromLine: number;
  toLine: number;
  text: string;
};

type SelectionAction = {
  ranges: GitCodeSelection[];
  left: number;
  top: number;
};

const GitEditor = forwardRef<GitEditorHandle, {
  path: string;
  current: string;
  original: string;
  askDisabled: boolean;
  onDirty(): void;
  onSave(value: string): void;
  onAskSelection(ranges: GitCodeSelection[]): void;
}>(function GitEditor({
  path,
  current,
  original,
  askDisabled,
  onDirty,
  onSave,
  onAskSelection,
}, ref): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const parent = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>();
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const handlers = useRef({ onDirty, onSave, onAskSelection });
  handlers.current = { onDirty, onSave, onAskSelection };

  useImperativeHandle(ref, () => ({
    value: () => editor.current?.state.doc.toString() ?? current,
  }), [current]);

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
            EditorState.allowMultipleSelections.of(true),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            highlightActiveLine(),
            EditorView.lineWrapping,
            syntaxHighlighting(editorHighlighting),
            keymap.of([
              { key: "Mod-s", run: (target) => { handlers.current.onSave(target.state.doc.toString()); return true; } },
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
              ...(current === original ? {} : { collapseUnchanged: { margin: 3, minSize: 6 } }),
            }),
            rightDiffGutter,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) handlers.current.onDirty();
              if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
                showSelectionAction(update.view, root.current, setSelectionAction);
              }
            }),
            editorTheme,
            language,
          ],
        }),
      });
      editor.current = view;
    });

    return () => {
      cancelled = true;
      view?.destroy();
      if (editor.current === view) editor.current = undefined;
    };
  }, [current, original, path]);

  return (
    <div className="git-editor" ref={root}>
      <div className="git-editor-host" ref={parent} />
      {selectionAction ? (
        <button
          className="git-editor-ask"
          type="button"
          disabled={askDisabled}
          title={askDisabled ? "Save this file before asking about the selection" : "Attach selected code to the conversation"}
          style={{ left: selectionAction.left, top: selectionAction.top } as CSSProperties}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => handlers.current.onAskSelection(selectionAction.ranges)}
        >Ask Snaffle</button>
      ) : null}
    </div>
  );
});

export default GitEditor;

function showSelectionAction(
  view: EditorView,
  root: HTMLDivElement | null,
  show: (action: SelectionAction | null) => void,
): void {
  if (!root) return;
  const ranges = view.state.selection.ranges.filter((range) => !range.empty);
  const last = ranges.at(-1);
  if (!last) {
    show(null);
    return;
  }
  const coordinates = view.coordsAtPos(last.to);
  if (!coordinates) {
    show(null);
    return;
  }

  const bounds = root.getBoundingClientRect();
  const buttonWidth = 98;
  const below = coordinates.bottom - bounds.top + 6;
  const top = below + 32 < bounds.height ? below : coordinates.top - bounds.top - 34;
  show({
    ranges: ranges.map((range) => {
      const finalPosition = Math.max(range.from, range.to - 1);
      return {
        fromLine: view.state.doc.lineAt(range.from).number,
        toLine: view.state.doc.lineAt(finalPosition).number,
        text: view.state.doc.sliceString(range.from, range.to),
      };
    }),
    left: Math.max(8, Math.min(coordinates.left - bounds.left, bounds.width - buttonWidth - 8)),
    top: Math.max(8, top),
  });
}

const addedGutterMarker = new class extends GutterMarker {
  elementClass = "cm-changedLineGutter";
}();

const removedGutterMarker = new class extends GutterMarker {
  elementClass = "cm-deletedLineGutter";
}();

const modifiedGutterMarker = new class extends GutterMarker {
  elementClass = "cm-inlineChangedLineGutter";
}();

const rightDiffGutter = gutter({
  class: "cm-changeGutter cm-changeGutter-right",
  side: "after",
  markers(view) {
    const builder = new RangeSetBuilder<GutterMarker>();
    const chunks = getChunks(view.state)?.chunks ?? [];
    for (const chunk of chunks) {
      if (chunk.fromB === chunk.toB) continue;
      const marker = displaysInline(view.state, chunk) ? modifiedGutterMarker : addedGutterMarker;
      for (let line = view.state.doc.lineAt(chunk.fromB);;) {
        builder.add(line.from, line.from, marker);
        if (line.to >= chunk.endB) break;
        line = view.state.doc.lineAt(line.to + 1);
      }
    }
    return builder.finish();
  },
  widgetMarker(view, widget) {
    return widget.toDOM(view).classList.contains("cm-deletedChunk") ? removedGutterMarker : null;
  },
});

function displaysInline(state: EditorState, chunk: Chunk): boolean {
  const original = getOriginalDoc(state);
  const originalLines = original.lineAt(chunk.endA).number - original.lineAt(chunk.fromA).number + 1;
  const currentLines = state.doc.lineAt(chunk.endB).number - state.doc.lineAt(chunk.fromB).number + 1;
  if (originalLines !== currentLines || originalLines >= 10) return false;

  let deletedCharacters = 0;
  for (const change of chunk.changes) {
    if (change.fromA === change.toA) continue;
    deletedCharacters += change.toA - change.fromA;
    const deleted = original.sliceString(chunk.fromA + change.fromA, chunk.fromA + change.toA);
    if (deleted.includes("\n")) return false;
  }
  return deletedCharacters < chunk.endA - chunk.fromA - originalLines * 2;
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
    fontSize: "calc(var(--editor-font-size, 13px) - 1px)",
    lineHeight: "1.65",
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
    backgroundColor: "transparent",
  },
  ".cm-deletedChunk": {
    backgroundColor: "transparent",
  },
  ".cm-inlineChangedLine": { backgroundColor: "transparent" },
  ".cm-deletedChunk, .cm-deletedChunk *": { userSelect: "text" },
  ".cm-deletedChunk ::selection": { backgroundColor: "var(--editor-selection-background)" },
  ".cm-deletedLine del, &.cm-merge-b del.cm-deletedText": {
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in srgb, var(--diff-removed-text) 58%, transparent)",
    textDecorationThickness: "1px",
  },
  "&.cm-merge-b .cm-deletedText": { background: "none" },
  "&.cm-merge-b .cm-changedText, &.cm-merge-b .cm-insertedLine": {
    background: "linear-gradient(color-mix(in srgb, var(--diff-added-text) 68%, transparent), color-mix(in srgb, var(--diff-added-text) 68%, transparent)) bottom / 100% 2px no-repeat",
  },
  "&.cm-merge-b .cm-changedLineGutter": { background: "var(--diff-added-text)" },
  ".cm-deletedLineGutter": { background: "var(--diff-removed-text)" },
  ".cm-inlineChangedLineGutter": { background: "var(--syntax-type)" },
  ".cm-changeGutter-right": { width: "4px", paddingLeft: "0" },
  ".cm-changeGutter-right .cm-gutterElement": { minWidth: "4px" },
  ".cm-collapsedLines": {
    color: "var(--text-muted)",
    background: "color-mix(in srgb, var(--text-faint) 12%, var(--code-background))",
  },
});

const editorHighlighting = HighlightStyle.define([
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
