import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { getChunks, getOriginalDoc, unifiedMergeView, type Chunk } from "@codemirror/merge";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
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
import type { CodeSelectionAttachment } from "../../../../api.js";
import { languageForPath } from "../../../components/file-language.js";
import { SidebarContextMenu as ContextMenu } from "../../sidebar/context-menu.js";
import "./editor.css";

export type GitEditorHandle = { value(): string };
export type GitCodeSelection = {
  fromLine: number;
  toLine: number;
  text: string;
};

type SelectionAction = {
  ranges: GitCodeSelection[];
  positions: Array<{ from: number; to: number }>;
  deletedChunks: HTMLElement[];
  left: number;
  top: number;
};

const setAttachedRanges = StateEffect.define<Array<{ id: string; from: number; to: number }>>();
const attachedRanges = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setAttachedRanges)) {
        decorations = Decoration.set(
          effect.value.map(({ id, from, to }) => Decoration.mark({
            class: "cm-attachedSelection",
            attachmentId: id,
          }).range(from, to)),
          true,
        );
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const GitEditor = forwardRef<GitEditorHandle, {
  path: string;
  current: string;
  original: string;
  askDisabled: boolean;
  attachments: CodeSelectionAttachment[];
  onDirty(): void;
  onSave(value: string): void;
  onAskSelection(ranges: GitCodeSelection[], note: string): Promise<string>;
  onRemoveAttachment(id: string): Promise<void>;
}>(function GitEditor({
  path,
  current,
  original,
  askDisabled,
  attachments,
  onDirty,
  onSave,
  onAskSelection,
  onRemoveAttachment,
}, ref): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const parent = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>();
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const deletedAttachmentIds = useRef(new Map<HTMLElement, string>());
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [removePrompt, setRemovePrompt] = useState<{ id: string; left: number; top: number } | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ top: number; left: number; action: SelectionAction } | null>(null);
  const handlers = useRef({ onDirty, onSave, onAskSelection, onRemoveAttachment });
  handlers.current = { onDirty, onSave, onAskSelection, onRemoveAttachment };

  useEffect(() => {
    const view = editor.current;
    if (view) syncAttachmentHighlights(view, root.current, attachments, deletedAttachmentIds.current);
    setRemovePrompt((current) => current && attachments.some(({ id }) => id === current.id) ? current : null);
  }, [attachments]);

  useImperativeHandle(ref, () => ({
    value: () => editor.current?.state.doc.toString() ?? current,
  }), [current]);

  useEffect(() => {
    let view: EditorView | undefined;
    let cancelled = false;
    let pointerDown = false;
    let selectionFrame: number | undefined;
    deletedAttachmentIds.current.clear();
    setRemovePrompt(null);

    function refreshSelection(): void {
      if (!view) return;
      if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame);
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = undefined;
        if (view) {
          showSelectionAction(view, root.current, setSelectionAction);
          syncDeletedHighlights(root.current, attachmentsRef.current, deletedAttachmentIds.current);
        }
      });
    }

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
            attachedRanges,
            rightDiffGutter,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) handlers.current.onDirty();
              if (update.docChanged || update.selectionSet) {
                setNoteOpen(false);
                setNote("");
                setRemovePrompt(null);
              }
              if (update.docChanged || (!pointerDown && update.selectionSet) || update.viewportChanged || update.geometryChanged) {
                refreshSelection();
              }
              if (update.viewportChanged || update.geometryChanged) setRemovePrompt(null);
            }),
            editorTheme,
            ...(language ? [language] : []),
          ],
        }),
      });
      editor.current = view;
      syncAttachmentHighlights(view, root.current, attachmentsRef.current, deletedAttachmentIds.current);
      view.dom.addEventListener("pointerdown", () => { pointerDown = true; setRemovePrompt(null); });
      view.dom.addEventListener("pointerup", () => { pointerDown = false; refreshSelection(); });
      view.dom.addEventListener("keyup", refreshSelection);
      view.dom.addEventListener("contextmenu", refreshSelection);
      view.scrollDOM.addEventListener("scroll", () => setRemovePrompt(null));
    });

    return () => {
      cancelled = true;
      if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame);
      view?.destroy();
      if (editor.current === view) editor.current = undefined;
    };
  }, [current, original, path]);

  async function addSelection(): Promise<void> {
    if (!selectionAction || adding) return;
    setAdding(true);
    try {
      const attached = selectionAction;
      const attachmentId = await handlers.current.onAskSelection(attached.ranges, note.trim());
      const view = editor.current;
      if (view) view.dispatch({ selection: { anchor: view.state.selection.main.to } });
      setNoteOpen(false);
      setNote("");
      setRemovePrompt({ id: attachmentId, left: attached.left, top: attached.top });
    } catch {
      // The Git panel keeps the popover open and displays the attachment error.
    } finally {
      setAdding(false);
    }
  }

  async function removeSelection(id: string): Promise<void> {
    if (removing) return;
    setRemoving(id);
    try {
      await handlers.current.onRemoveAttachment(id);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="git-editor" ref={root}>
      <div
        className="git-editor-host"
        ref={parent}
        onContextMenu={(event) => {
          if (!editor.current || !root.current) return;
          const action = selectionActionFor(editor.current, root.current);
          if (!action) return;
          event.preventDefault();
          setSelectionMenu({ top: event.clientY, left: event.clientX, action });
        }}
        onClick={(event) => {
          const view = editor.current;
          const container = root.current;
          if (!view || !container || selectionActionFor(view, container)) return;
          const deleted = (event.target as HTMLElement).closest<HTMLElement>(".cm-attachedChunk");
          const deletedId = deleted ? deletedAttachmentIds.current.get(deleted) : undefined;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const id = deletedId ?? (position === null ? undefined : attachedIdAt(view, position));
          if (!id) {
            setRemovePrompt(null);
            return;
          }
          const bounds = container.getBoundingClientRect();
          setRemovePrompt({
            id,
            left: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 154)),
            top: Math.max(8, event.clientY - bounds.top + 8),
          });
        }}
      />
      {selectionAction && noteOpen ? (
        <form
          className="git-editor-note"
          style={{
            left: Math.max(8, Math.min(selectionAction.left, (root.current?.clientWidth ?? 300) - 288)),
            top: Math.max(8, Math.min(selectionAction.top, (root.current?.clientHeight ?? 160) - 132)),
          } as CSSProperties}
          onSubmit={(event) => { event.preventDefault(); void addSelection(); }}
        >
          <textarea
            autoFocus
            value={note}
            maxLength={4_000}
            rows={3}
            placeholder="What should Snaffle do here?"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setNoteOpen(false);
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div>
            <button type="button" onClick={() => setNoteOpen(false)}>Cancel</button>
            <button className="primary" type="submit" disabled={adding}>{adding ? "Adding…" : "Add to message"}</button>
          </div>
        </form>
      ) : selectionAction ? (
        <button
          className="git-editor-ask"
          type="button"
          disabled={askDisabled}
          title={askDisabled ? "Save this file before asking about the selection" : "Attach selected code to the conversation"}
          style={{ left: selectionAction.left, top: selectionAction.top } as CSSProperties}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setNoteOpen(true)}
        >Ask Snaffle</button>
      ) : null}
      {removePrompt && attachments.some(({ id }) => id === removePrompt.id) ? (
        <button
          className="git-editor-remove"
          type="button"
          disabled={removing === removePrompt.id}
          style={{ left: removePrompt.left, top: removePrompt.top } as CSSProperties}
          onClick={() => void removeSelection(removePrompt.id)}
        >{removing === removePrompt.id ? "Removing…" : "Remove from message"}</button>
      ) : null}
      {selectionMenu ? (
        <ContextMenu
          top={selectionMenu.top}
          left={selectionMenu.left}
          items={[
            {
              label: "Ask Snaffle",
              action: () => {
                setSelectionAction(selectionMenu.action);
                setNoteOpen(true);
              },
            },
            {
              label: "Copy selection",
              action: () => void window.desktop.writeClipboardText(
                selectionMenu.action.ranges.map((range) => range.text).join("\n\n"),
              ),
            },
          ]}
          onClose={() => setSelectionMenu(null)}
        />
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
  show(root ? selectionActionFor(view, root) : null);
}

function selectionActionFor(view: EditorView, root: HTMLDivElement): SelectionAction | null {
  const native = nativeDiffSelection(view, root);
  if (native) return native;
  const ranges = view.state.selection.ranges.filter((range) => !range.empty);
  const last = ranges.at(-1);
  if (!last) return null;
  const coordinates = view.coordsAtPos(last.to);
  if (!coordinates) return null;

  const bounds = root.getBoundingClientRect();
  const buttonWidth = 98;
  const below = coordinates.bottom - bounds.top + 6;
  const top = below + 32 < bounds.height ? below : coordinates.top - bounds.top - 34;
  return {
    ranges: ranges.map((range) => {
      const finalPosition = Math.max(range.from, range.to - 1);
      return {
        fromLine: view.state.doc.lineAt(range.from).number,
        toLine: view.state.doc.lineAt(finalPosition).number,
        text: view.state.doc.sliceString(range.from, range.to),
      };
    }),
    positions: ranges.map(({ from, to }) => ({ from, to })),
    deletedChunks: [],
    left: Math.max(8, Math.min(coordinates.left - bounds.left, bounds.width - buttonWidth - 8)),
    top: Math.max(8, top),
  };
}

function nativeDiffSelection(view: EditorView, root: HTMLDivElement): SelectionAction | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  const deletedChunks = [...root.querySelectorAll<HTMLElement>(".cm-deletedChunk")]
    .filter((element) => range.intersectsNode(element));
  if (!deletedChunks.length) return undefined;
  const text = selection.toString();
  if (!text.trim()) return undefined;

  const fallback = view.state.selection.main.head;
  const start = positionAtDom(view, range.startContainer, range.startOffset, fallback);
  const end = positionAtDom(view, range.endContainer, range.endOffset, start);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const finalPosition = Math.max(from, to - 1);
  const rectangles = [...range.getClientRects()];
  const coordinates = rectangles.at(-1) ?? range.getBoundingClientRect();
  const bounds = root.getBoundingClientRect();
  const buttonWidth = 98;
  const below = coordinates.bottom - bounds.top + 6;
  const top = below + 32 < bounds.height ? below : coordinates.top - bounds.top - 34;
  return {
    ranges: [{
      fromLine: view.state.doc.lineAt(from).number,
      toLine: view.state.doc.lineAt(finalPosition).number,
      text,
    }],
    positions: from < to ? [{ from, to }] : [],
    deletedChunks,
    left: Math.max(8, Math.min(coordinates.left - bounds.left, bounds.width - buttonWidth - 8)),
    top: Math.max(8, top),
  };
}

function positionAtDom(view: EditorView, node: Node, offset: number, fallback: number): number {
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return fallback;
  }
}

function attachedIdAt(view: EditorView, position: number): string | undefined {
  let id: string | undefined;
  view.state.field(attachedRanges).between(
    Math.max(0, position - 1),
    Math.min(view.state.doc.length, position + 1),
    (from, to, decoration) => {
      if (from <= position && position <= to && typeof decoration.spec.attachmentId === "string") {
        id = decoration.spec.attachmentId;
      }
    },
  );
  return id;
}

function syncAttachmentHighlights(
  view: EditorView,
  root: HTMLDivElement | null,
  attachments: CodeSelectionAttachment[],
  deletedIds: Map<HTMLElement, string>,
): void {
  const ranges = attachments.flatMap((attachment) => currentDocumentRanges(view.state, attachment)
    .map(({ from, to }) => ({ id: attachment.id, from, to })));
  view.dispatch({ effects: setAttachedRanges.of(ranges) });
  syncDeletedHighlights(root, attachments, deletedIds);
}

function currentDocumentRanges(
  state: EditorState,
  attachment: CodeSelectionAttachment,
): Array<{ from: number; to: number }> {
  return attachment.ranges.flatMap((range) => {
    if (range.fromLine > state.doc.lines) return [];
    const first = state.doc.line(range.fromLine);
    const last = state.doc.line(Math.min(range.toLine, state.doc.lines));
    const region = state.doc.sliceString(first.from, last.to);
    const nearby = region.indexOf(range.text);
    const from = nearby < 0 ? state.doc.toString().indexOf(range.text) : first.from + nearby;
    return from < 0 ? [] : [{ from, to: from + range.text.length }];
  });
}

function syncDeletedHighlights(
  root: HTMLDivElement | null,
  attachments: CodeSelectionAttachment[],
  deletedIds: Map<HTMLElement, string>,
): void {
  deletedIds.forEach((_id, chunk) => chunk.classList.remove("cm-attachedChunk"));
  deletedIds.clear();
  if (!root) return;
  const deletedChunks = [...root.querySelectorAll<HTMLElement>(".cm-deletedChunk")];
  for (const attachment of attachments) {
    for (const range of attachment.ranges) {
      const text = range.text.trim();
      if (!text) continue;
      for (const chunk of deletedChunks) {
        if (!chunk.textContent?.includes(text)) continue;
        chunk.classList.add("cm-attachedChunk");
        deletedIds.set(chunk, attachment.id);
      }
    }
  }
}

const addedGutterMarker = new class extends GutterMarker {
  elementClass = "cm-changedLineGutter";
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
  ".cm-attachedSelection": {
    backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
    boxShadow: "inset 0 -2px color-mix(in srgb, var(--primary) 72%, transparent)",
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
    boxShadow: "inset 3px 0 var(--diff-removed-text), inset -3px 0 var(--diff-removed-text)",
  },
  ".cm-deletedChunk.cm-attachedChunk": {
    backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)",
  },
  ".cm-inlineChangedLine": { backgroundColor: "transparent" },
  ".cm-deletedChunk, .cm-deletedChunk *": { userSelect: "text" },
  ".cm-deletedChunk, .cm-deletedChunk *, .cm-deletedText, .cm-deletedText *": {
    color: "var(--code-text) !important",
  },
  ".cm-deletedChunk ::selection": { backgroundColor: "var(--editor-selection-background)" },
  ".cm-deletedLine del, &.cm-merge-b del.cm-deletedText": {
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in srgb, var(--diff-removed-text) 58%, transparent)",
    textDecorationThickness: "1px",
  },
  "&.cm-merge-b .cm-deletedText": { background: "none" },
  "&.cm-merge-b .cm-changedText": {
    background: "linear-gradient(color-mix(in srgb, var(--syntax-type) 68%, transparent), color-mix(in srgb, var(--syntax-type) 68%, transparent)) bottom / 100% 2px no-repeat",
  },
  "&.cm-merge-b .cm-insertedLine": { background: "none" },
  "&.cm-merge-b .cm-changedLineGutter": { background: "var(--diff-added-text)" },
  ".cm-deletedLineGutter": { background: "transparent" },
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
  { tag: tags.variableName, color: "var(--syntax-type)" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName), tags.propertyName], color: "var(--syntax-function)" },
  { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
  { tag: [tags.tagName, tags.attributeName], color: "var(--syntax-tag)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--syntax-operator)" },
]);
