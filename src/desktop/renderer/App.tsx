import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AttachmentPreview, AttachmentRef } from "../../attachments/types.js";
import type { CommandApprovalDecision } from "../../protocol.js";
import type { DesktopApi, DesktopRunEvent, DesktopSearchResult, DesktopState, DesktopThread, SavedMessage } from "../api.js";
import type { ProviderCatalog, ProviderConnectionInput, ProviderStatus } from "../../providers/provider.js";
import type { CompactionMode } from "../../context/budget.js";
import type { SubagentProfile } from "../../agent/subagents/profile.js";
import type { ContextReport } from "../../context/report.js";
import type { KetchSearchBackend, WebSearchBackend } from "../../tools/web/types.js";
import { DEFAULT_MODEL_CONTEXT_LENGTH } from "../../providers/provider.js";
import { providerProfile, splitModelVariant } from "../../providers/profiles.js";
import { DEFAULT_THEME, themeById, type Theme } from "../themes/index.js";
import {
  CONVERSATION_FONT_BASE,
  DEFAULT_CODE_BLOCK_FONT_SIZE,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_FONTS,
  DEFAULT_FONT_SCALE,
  fontById,
  validFontScale,
  type FontId,
} from "../typography.js";
import { AttachmentTray } from "./sections/conversation/attachment-tray.js";
import { htmlToMarkdown } from "./sections/conversation/attachment-markdown.js";
import { Settings } from "./screens/settings/settings.js";
import { Bookmarks, type BookmarksPage } from "./screens/bookmarks/bookmarks.js";
import { Search } from "./screens/search/search.js";
import { Sidebar, type AppView, type SettingsPage } from "./sections/sidebar/sidebar.js";
import { InspectorPanel, type InspectorTab } from "./sections/inspector/panel.js";
import type { OrbMotion } from "./components/thinking-orb.js";
import { Composer } from "./sections/conversation/composer.js";
import {
  TimelineEntry,
} from "./sections/conversation/timeline.js";
import {
  addRunEvent,
  findTimelineItem,
  newTimelineId,
  timelineFromEntries,
  type SaveableTimelineItem,
  type TimelineItem,
} from "./sections/conversation/timeline-state.js";

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

const initialState: DesktopState = {
  workspace: null,
  workspaces: [],
  activeThreadId: null,
  conversation: [],
  contextCheckpoints: [],
  modelInstructions: [],
  toolSpecs: [],
  savedMessages: [],
  providerConnections: [],
  openRouterAvailable: false,
  ketchAvailable: false,
  webSearchEnabled: true,
  webSearchBackend: "ddg",
  webSearchKeyBackends: [],
  runningThreadIds: [],
  unsafeThreadIds: [],
  defaultModel: null,
  defaultProviderConnectionId: "openrouter",
  restrictedHostAvailable: false,
  restrictedHostDetail: "Checking restricted execution…",
  themeId: document.documentElement.dataset.theme ?? DEFAULT_THEME.id,
  interfaceFont: fontById(document.documentElement.dataset.interfaceFont)?.id ?? DEFAULT_FONTS.interface,
  primaryFont: fontById(document.documentElement.dataset.primaryFont)?.id ?? DEFAULT_FONTS.primary,
  secondaryFont: fontById(document.documentElement.dataset.secondaryFont)?.id ?? DEFAULT_FONTS.secondary,
  codeFont: fontById(document.documentElement.dataset.codeFont)?.id ?? DEFAULT_FONTS.code,
  interfaceFontScale: validFontScale(document.documentElement.dataset.interfaceFontScale) ?? DEFAULT_FONT_SCALE,
  conversationFontScale: validFontScale(document.documentElement.dataset.conversationFontScale) ?? DEFAULT_FONT_SCALE,
  codeBlockFontSize: DEFAULT_CODE_BLOCK_FONT_SIZE,
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  editorCommand: "",
  editorArguments: "",
  maxSteps: 50,
  providerTimeoutMinutes: 3,
  providerRetries: 4,
  subagent: {
    enabled: false,
    providerConnectionId: "",
    model: "",
    maxSteps: 30,
  },
  compactionMode: "automatic",
  compactionThreshold: 65,
};

export function App(): JSX.Element {
  const [desktopState, setDesktopState] = useState(initialState);
  const [savedMessages, setSavedMessages] = useState<SavedMessage[] | null>(null);
  const [models, setModels] = useState<ProviderCatalog[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProviderConnectionId, setSelectedProviderConnectionId] = useState("openrouter");
  const [task, setTask] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentPreview[]>([]);
  const [draggingAttachments, setDraggingAttachments] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(270);
  const [rightWidth, setRightWidth] = useState(320);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("inspect");
  const [view, setView] = useState<AppView>("conversation");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  const [bookmarksPage, setBookmarksPage] = useState<BookmarksPage>("threads");
  const [sendOrbMotion, setSendOrbMotion] = useState<OrbMotion>("stopped");
  const [contextReport, setContextReport] = useState<ContextReport | null>(null);
  const [contextRefresh, setContextRefresh] = useState(0);
  const [compactingContext, setCompactingContext] = useState(false);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const timelineView = useRef<HTMLDivElement>(null);
  const executionMode = useRef<HTMLDetailsElement>(null);
  const composerAdd = useRef<HTMLDetailsElement>(null);
  const searchOpenedAt = useRef(0);

  useEffect(() => {
    function toggleSearch(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (view === "search") {
        if (performance.now() - searchOpenedAt.current >= 300) setView("conversation");
        return;
      }
      setError(null);
      searchOpenedAt.current = performance.now();
      setView("search");
    }

    window.addEventListener("keydown", toggleSearch);
    return () => window.removeEventListener("keydown", toggleSearch);
  }, [view]);
  const followTimeline = useRef(true);
  const leftAutoCollapsed = useRef(false);
  const fileEditorExpanded = useRef(false);
  const layoutBeforeFileEditor = useRef<{
    rightWidth: number;
    leftCollapsed: boolean;
    leftAutoCollapsed: boolean;
  } | null>(null);
  const rightWidthValue = useRef(rightWidth);
  const leftCollapsedValue = useRef(leftCollapsed);
  const activeThreadId = useRef<string | null>(null);
  const threadTimelines = useRef(new Map<string, TimelineItem[]>());
  const threadAttachments = useRef(new Map<string, AttachmentPreview[]>());
  rightWidthValue.current = rightWidth;
  leftCollapsedValue.current = leftCollapsed;
  const running = desktopState.activeThreadId
    ? desktopState.runningThreadIds.includes(desktopState.activeThreadId)
    : false;
  const unsafeHostExecution = desktopState.activeThreadId
    ? desktopState.unsafeThreadIds.includes(desktopState.activeThreadId)
    : false;

  const expandFileEditor = useCallback((expanded: boolean): void => {
    if (fileEditorExpanded.current === expanded) return;
    fileEditorExpanded.current = expanded;

    if (expanded) {
      layoutBeforeFileEditor.current = {
        rightWidth: rightWidthValue.current,
        leftCollapsed: leftCollapsedValue.current,
        leftAutoCollapsed: leftAutoCollapsed.current,
      };
      leftAutoCollapsed.current = false;
      setLeftCollapsed(true);
      setRightCollapsed(false);
      setRightWidth(focusedEditorWidth());
      return;
    }

    const previous = layoutBeforeFileEditor.current;
    layoutBeforeFileEditor.current = null;
    if (!previous) return;
    leftAutoCollapsed.current = previous.leftAutoCollapsed;
    setRightWidth(previous.rightWidth);
    setLeftCollapsed(previous.leftCollapsed);
  }, []);

  useLayoutEffect(() => {
    const input = taskInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [task]);

  useLayoutEffect(() => {
    const view = timelineView.current;
    if (view && followTimeline.current) view.scrollTop = view.scrollHeight;
  }, [timeline]);

  useEffect(() => {
    if (view === "conversation") {
      taskInput.current?.focus({ preventScroll: true });
    }
  }, [desktopState.activeThreadId, running, view]);

  useEffect(() => {
    if (running) {
      setSendOrbMotion("active");
      return;
    }
    setSendOrbMotion((motion) => (motion === "active" ? "settling" : motion));
  }, [running]);

  useEffect(() => {
    if (sendOrbMotion !== "settling") return;
    const timer = window.setTimeout(() => setSendOrbMotion("stopped"), 2300);
    return () => window.clearTimeout(timer);
  }, [sendOrbMotion]);

  useEffect(() => {
    document.documentElement.style.setProperty("--code-block-font-size", `${desktopState.codeBlockFontSize}px`);
  }, [desktopState.codeBlockFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${desktopState.editorFontSize}px`);
  }, [desktopState.editorFontSize]);

  useEffect(() => {
    applyTypography(desktopState.interfaceFont, desktopState.primaryFont, desktopState.secondaryFont, desktopState.codeFont);
  }, [desktopState.interfaceFont, desktopState.primaryFont, desktopState.secondaryFont, desktopState.codeFont]);

  useEffect(() => {
    applyTypographyScale("interface", desktopState.interfaceFontScale);
    applyTypographyScale("conversation", desktopState.conversationFontScale);
  }, [desktopState.interfaceFontScale, desktopState.conversationFontScale]);

  useEffect(() => {
    let reopenTimer: number | undefined;

    function updateSidebarForInspector(): void {
      if (reopenTimer !== undefined) {
        window.clearTimeout(reopenTimer);
        reopenTimer = undefined;
      }
      if (view !== "conversation" || rightCollapsed) return;

      if (fileEditorExpanded.current) {
        const expandedWidth = focusedEditorWidth();
        if (rightWidth !== expandedWidth) setRightWidth(expandedWidth);
        return;
      }

      if (rightWidth > window.innerWidth / 2) {
        setLeftCollapsed((collapsed) => {
          if (collapsed) return true;
          leftAutoCollapsed.current = true;
          return true;
        });
      } else if (rightWidth < window.innerWidth * 0.4 && leftAutoCollapsed.current) {
        reopenTimer = window.setTimeout(() => {
          leftAutoCollapsed.current = false;
          setLeftCollapsed(false);
        }, 500);
      }
    }

    updateSidebarForInspector();
    window.addEventListener("resize", updateSidebarForInspector);
    return () => {
      if (reopenTimer !== undefined) window.clearTimeout(reopenTimer);
      window.removeEventListener("resize", updateSidebarForInspector);
    };
  }, [rightCollapsed, rightWidth, view]);

  useEffect(() => {
    function closeOpenMenus(event: PointerEvent): void {
      for (const details of [executionMode.current, composerAdd.current]) {
        if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
          details.open = false;
        }
      }
    }

    document.addEventListener("pointerdown", closeOpenMenus);
    return () => document.removeEventListener("pointerdown", closeOpenMenus);
  }, []);

  useEffect(() => {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    const timeout = window.setTimeout(() => {
      void window.desktop.setThreadDraft(threadId, task).catch((cause) => {
        setError(errorMessage(cause));
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [desktopState.activeThreadId, task]);

  useEffect(() => {
    if (view !== "saved") {
      setSavedMessages(null);
      return;
    }
    let current = true;
    void window.desktop.listSavedMessages().then(
      (messages) => { if (current) setSavedMessages(messages); },
      (cause: unknown) => { if (current) setError(errorMessage(cause)); },
    );
    return () => { current = false; };
  }, [view]);

  useEffect(() => {
    let queuedEvents: DesktopRunEvent[] = [];
    let flushTimer: number | undefined;

    function applyRunEvent({ threadId, event }: DesktopRunEvent): void {
      if (event.type === "run.persisted" && activeThreadId.current !== threadId) {
        threadTimelines.current.delete(threadId);
        return;
      }
      if (event.type.startsWith("context.") && activeThreadId.current !== threadId) {
        threadTimelines.current.delete(threadId);
        return;
      }
      addRunEvent(event, (update) => {
        const next = update(threadTimelines.current.get(threadId) ?? []);
        threadTimelines.current.set(threadId, next);
        if (activeThreadId.current === threadId) setTimeline(next);
      });

      if (event.type === "run.started") {
        setDesktopState((state) => ({
          ...state,
          runningThreadIds: [...new Set([...state.runningThreadIds, threadId])],
          ...(activeThreadId.current === threadId && event.instructions?.length
            ? { modelInstructions: event.instructions }
            : {}),
        }));
      }
      if (event.type === "run.completed" || event.type === "run.failed") {
        setDesktopState((state) => ({
          ...state,
          runningThreadIds: state.runningThreadIds.filter((id) => id !== threadId),
        }));
      }
      if (event.type === "run.persisted" || event.type.startsWith("context.")) {
        setContextRefresh((value) => value + 1);
      }
    }

    function flushEvents(): void {
      flushTimer = undefined;
      const events = queuedEvents;
      queuedEvents = [];
      events.forEach(applyRunEvent);
    }

    void window.desktop
      .getState()
      .then((state) => {
        activeThreadId.current = state.activeThreadId;
        const initialTimeline = timelineFromEntries(state.conversation, state.contextCheckpoints);
        setDesktopState(withoutConversation(state));
        if (state.activeThreadId) threadTimelines.current.set(state.activeThreadId, initialTimeline);
        setTimeline(initialTimeline);
        setTask(activeDraft(state));
        const selection = activeModel(state);
        setSelectedModel(selection.model);
        setSelectedProviderConnectionId(selection.providerConnectionId);
        void loadModels();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));

    const unsubscribe = window.desktop.onRunEvent((event) => {
      const previous = queuedEvents.at(-1);
      if (!previous || !mergeStreamEvent(previous, event)) queuedEvents.push(event);
      flushTimer ??= window.setTimeout(flushEvents, 16);
    });

    return () => {
      unsubscribe();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    };
  }, []);

  const selectedItem = useMemo(
    () => findTimelineItem(timeline, selectedItemId),
    [selectedItemId, timeline],
  );
  const previousAssistantModels = useMemo(() => modelTransitions(timeline), [timeline]);
  const visibleLeftWidth = leftCollapsed ? 0 : leftWidth;
  const visibleRightWidth = view !== "conversation" || rightCollapsed ? 0 : rightWidth;
  const activeContextAttachments = useMemo(() => {
    const active = new Map<string, AttachmentRef>();
    for (const item of timeline) {
      if (item.kind !== "user") continue;
      for (const attachment of item.attachments ?? []) {
        if (attachment.includeInContext !== false) active.set(attachment.id, attachment);
      }
    }
    return [...active.values()];
  }, [timeline]);
  const contextAttachments = [...activeContextAttachments, ...pendingAttachments];
  const attachmentTokens = contextAttachments.reduce(
    (total, attachment) => total + attachment.estimatedTokens,
    0,
  );
  const selectedCatalog = models.find((catalog) => catalog.connection.id === selectedProviderConnectionId);
  const selectedProfile = selectedCatalog ? providerProfile(selectedCatalog.connection.providerId) : undefined;
  const selectedModelBase = splitModelVariant(selectedModel, selectedProfile?.modelVariants).baseModelId;
  const selectedProviderModel = selectedCatalog?.models.find((model) => model.id === selectedModel) ??
    selectedCatalog?.models.find((model) => model.id === selectedModelBase);
  const selectedContextLength = selectedProviderModel?.contextLength ??
    DEFAULT_MODEL_CONTEXT_LENGTH;
  const pendingContextTokens = Math.ceil(task.length / 4) + pendingAttachments.reduce(
    (total, attachment) => total + attachment.estimatedTokens,
    0,
  );
  const selectedModalities = selectedProviderModel?.inputModalities;
  const imageUnsupported = contextAttachments.some((attachment) => attachment.kind === "image") &&
    selectedModalities !== undefined && !selectedModalities.includes("image");
  const attachmentsTooLarge = attachmentTokens > selectedContextLength * 0.7;
  const runBlocker = !desktopState.workspace
    ? "Open a workspace before sending."
    : !task.trim() && pendingAttachments.length === 0
      ? "Describe a task or attach a file before sending."
      : !selectedModel || !selectedCatalog
        ? "Select a model before sending."
        : selectedCatalog.error && selectedCatalog.models.length === 0
          ? "The selected provider connection is unavailable."
        : attachmentsTooLarge
          ? "Attachments are too large for the selected model context."
          : imageUnsupported
            ? "The selected model does not accept images."
            : !unsafeHostExecution && !desktopState.restrictedHostAvailable
              ? desktopState.restrictedHostDetail
              : null;

  useEffect(() => {
    const threadId = desktopState.activeThreadId;
    if (!threadId) {
      setContextReport(null);
      return;
    }
    let current = true;
    void window.desktop.getContextReport(threadId, selectedContextLength).then(
      (report) => { if (current) setContextReport(report); },
      (cause: unknown) => { if (current) setError(errorMessage(cause)); },
    );
    return () => { current = false; };
  }, [contextRefresh, desktopState.activeThreadId, selectedContextLength]);

  async function compactCurrentContext(): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId || !selectedModel) return;
    setCompactingContext(true);
    setError(null);
    try {
      await window.desktop.compactContext(
        threadId,
        selectedProviderConnectionId,
        selectedModel,
        selectedContextLength,
      );
      setContextReport(await window.desktop.getContextReport(threadId, selectedContextLength));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCompactingContext(false);
    }
  }

  async function loadModels(): Promise<void> {
    setError(null);
    setLoadingModels(true);

    try {
      setModels(await window.desktop.listProviderModels());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingModels(false);
    }
  }

  async function startRun(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const threadId = desktopState.activeThreadId;

    if (running) {
      if (!threadId || !task.trim()) return;
      const message = task.trim();
      setTask("");
      try {
        if (!await window.desktop.steerRun(threadId, message)) {
          setTask(message);
          setError("The run finished before the message could be queued. Send it again.");
          return;
        }
        appendUserMessage(threadId, message);
      } catch (cause) {
        setTask(message);
        setError(errorMessage(cause));
      }
      return;
    }

    if (!threadId || runBlocker) {
      if (runBlocker) setError(runBlocker);
      return;
    }

    const request = {
      threadId,
      task: task.trim(),
      providerConnectionId: selectedProviderConnectionId,
      model: selectedModel,
      contextLength: selectedContextLength,
      ...(pendingAttachments.length
        ? { attachments: pendingAttachments.map(attachmentRef) }
        : {}),
    };

    followTimeline.current = true;
    appendUserMessage(request.threadId, request.task, pendingAttachments);
    const sentAttachments = pendingAttachments;
    setTask("");
    setPendingAttachments([]);
    threadAttachments.current.delete(request.threadId);
    setDesktopState((state) => ({
      ...state,
      runningThreadIds: [...new Set([...state.runningThreadIds, request.threadId])],
    }));

    try {
      await window.desktop.startRun(request);
    } catch (cause) {
      setDesktopState((state) => ({
        ...state,
        runningThreadIds: state.runningThreadIds.filter((id) => id !== request.threadId),
      }));
      setPendingAttachments(sentAttachments);
      threadAttachments.current.set(request.threadId, sentAttachments);
      setError(errorMessage(cause));
    }
  }

  async function restoreThread(sequence: number): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    const user = timeline.find((item) => item.kind === "user" && item.sequence === sequence);
    const restoredAttachments: AttachmentPreview[] = user?.kind === "user"
      ? (user.attachments ?? []).map((attachment) => ({ ...attachment, fingerprint: attachment.id }))
      : [];

    try {
      const state = await window.desktop.restoreThread(threadId, sequence);
      threadTimelines.current.delete(threadId);
      showDesktopState(state);
      threadAttachments.current.set(threadId, restoredAttachments);
      setPendingAttachments(restoredAttachments);
      window.requestAnimationFrame(() => taskInput.current?.focus());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function forkThread(sequence: number): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    try {
      await saveDraft();
      showDesktopState(await window.desktop.forkThread(threadId, sequence));
      window.requestAnimationFrame(() => taskInput.current?.focus());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function appendUserMessage(
    threadId: string,
    text: string,
    attachments: AttachmentPreview[] = [],
  ): void {
    followTimeline.current = true;
    setTimeline((items) => {
      const next = [
        ...items,
        {
          id: newTimelineId(),
          kind: "user" as const,
          text,
          ...(attachments.length ? { attachments: attachments.map(attachmentRef) } : {}),
          sequence: nextMessageSequence(items),
        },
      ];
      threadTimelines.current.set(threadId, next);
      return next;
    });
  }

  async function chooseAttachments(): Promise<void> {
    setError(null);
    try {
      await addAttachments(await window.desktop.chooseAttachments());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function addAttachments(imported: AttachmentPreview[]): Promise<void> {
    const fingerprints = new Set(pendingAttachments.map((attachment) => attachment.fingerprint));
    const unique = imported.filter((attachment) => {
      if (fingerprints.has(attachment.fingerprint)) return false;
      fingerprints.add(attachment.fingerprint);
      return true;
    });
    const duplicates = imported.filter((attachment) => !unique.includes(attachment));
    const remaining = Math.max(0, 8 - pendingAttachments.length);
    const accepted = unique.slice(0, remaining);
    const rejected = [...duplicates, ...unique.slice(remaining)];
    await Promise.all(
      rejected.map((item) => window.desktop.removeAttachment(item.id)),
    );
    if (unique.length > remaining) setError("Attach at most 8 files to one message");
    else if (duplicates.length) setError("That file is already attached");
    setPendingAttachments((current) => {
      const next = [...current, ...accepted];
      const threadId = desktopState.activeThreadId;
      if (threadId) threadAttachments.current.set(threadId, next);
      return next;
    });
  }

  async function dropAttachments(event: ReactDragEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setDraggingAttachments(false);
    if (running || event.dataTransfer.files.length === 0) return;
    setError(null);
    try {
      await addAttachments(
        await window.desktop.importDroppedFiles([...event.dataTransfer.files]),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function pasteIntoTask(event: ReactClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    if ([...event.clipboardData.items].some((item) => item.type.startsWith("image/"))) {
      event.preventDefault();
      setError(null);
      try {
        if (pendingAttachments.length >= 8) throw new Error("Attach at most 8 files to one message");
        await addAttachments([await window.desktop.importClipboardImage()]);
      } catch (cause) {
        setError(errorMessage(cause));
      }
      return;
    }

    if (!event.clipboardData.getData("text/html")) return;
    event.preventDefault();
    const plain = event.clipboardData.getData("text/plain");
    insertTaskText(plain, event.currentTarget);
  }

  async function removeAttachment(attachment: AttachmentPreview): Promise<void> {
    setPendingAttachments((current) => {
      const next = current.filter((item) => item.id !== attachment.id);
      const threadId = desktopState.activeThreadId;
      if (threadId) threadAttachments.current.set(threadId, next);
      return next;
    });
    try {
      await window.desktop.removeAttachment(attachment.id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function toggleAttachmentContext(
    item: Extract<TimelineItem, { kind: "user" }>,
    attachment: AttachmentRef,
  ): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId || running) return;
    const include = attachment.includeInContext === false;

    try {
      await window.desktop.setAttachmentContext(threadId, item.sequence, attachment.id, include);
      setTimeline((items) => {
        const next = items.map((candidate) => {
          if (candidate.id !== item.id || candidate.kind !== "user" || !candidate.attachments) {
            return candidate;
          }
          return {
            ...candidate,
            attachments: candidate.attachments.map((current) => {
              if (current.id !== attachment.id) return current;
              if (!include) return { ...current, includeInContext: false as const };
              const { includeInContext: _removed, ...restored } = current;
              return restored;
            }),
          };
        });
        threadTimelines.current.set(threadId, next);
        return next;
      });
      setContextRefresh((value) => value + 1);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function removeActiveAttachment(attachment: AttachmentRef): void {
    const item = timeline.find((candidate) => candidate.kind === "user" &&
      candidate.attachments?.some((current) => current.id === attachment.id));
    if (item?.kind === "user") void toggleAttachmentContext(item, attachment);
  }

  async function pastePlainText(): Promise<void> {
    const input = taskInput.current;
    if (!input) return;
    const plain = await window.desktop.readClipboardText();
    insertTaskText(plain, input);
  }

  async function pasteMarkdown(): Promise<void> {
    const input = taskInput.current;
    if (!input) return;
    setError(null);
    try {
      const html = await window.desktop.readClipboardHtml();
      const markdown = html ? await htmlToMarkdown(html) : await window.desktop.readClipboardText();
      insertTaskText(markdown, input);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function insertTaskText(text: string, input: HTMLTextAreaElement): void {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    setTask((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function stopRun(): Promise<void> {
    setError(null);
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;

    try {
      await window.desktop.stopRun(threadId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setThreadUnsafe(unsafe: boolean): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.setThreadUnsafe(threadId, unsafe)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function resolveCommandApproval(
    id: string,
    decision: CommandApprovalDecision,
  ): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.resolveCommandApproval(id, decision)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function showDesktopState(state: DesktopState): void {
    followTimeline.current = true;
    if (activeThreadId.current) {
      threadAttachments.current.set(activeThreadId.current, pendingAttachments);
    }
    trimThreadTimelines(threadTimelines.current, state.activeThreadId, state.runningThreadIds);
    activeThreadId.current = state.activeThreadId;
    const storedTimeline = state.activeThreadId
      ? threadTimelines.current.get(state.activeThreadId)
      : undefined;
    const nextTimeline = storedTimeline ?? timelineFromEntries(state.conversation, state.contextCheckpoints);
    setDesktopState(withoutConversation(state));
    if (state.activeThreadId && !storedTimeline) {
      threadTimelines.current.set(state.activeThreadId, nextTimeline);
    }
    setTimeline(nextTimeline);
    const selection = activeModel(state);
    setSelectedModel(selection.model);
    setSelectedProviderConnectionId(selection.providerConnectionId);
    setSelectedItemId(null);
    setTask(activeDraft(state));
    setPendingAttachments(
      state.activeThreadId ? threadAttachments.current.get(state.activeThreadId) ?? [] : [],
    );
    setError(null);
    setView("conversation");
  }

  function showView(next: AppView): void {
    if (next === "search") {
      if (view === "search") {
        if (performance.now() - searchOpenedAt.current >= 300) setView("conversation");
        return;
      }
      searchOpenedAt.current = performance.now();
    }
    setView(next);
  }

  async function saveDraft(): Promise<void> {
    if (desktopState.activeThreadId) {
      await window.desktop.setThreadDraft(desktopState.activeThreadId, task);
    }
  }

  function savedIdFor(item: SaveableTimelineItem): string | undefined {
    const threadId = desktopState.activeThreadId;
    if (!threadId || item.sequence === undefined) return undefined;
    return desktopState.savedMessages.find(
      (saved) =>
        (item.entryId ? saved.sourceEntryId === item.entryId : false) ||
        (saved.sourceThreadId === threadId &&
          saved.sourceSequence === item.sequence),
    )?.id;
  }

  async function toggleSavedMessage(item: SaveableTimelineItem, savedId?: string): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId || item.sequence === undefined) return;
    try {
      const savedMessages = savedId
        ? await window.desktop.deleteSavedMessage(savedId)
        : await window.desktop.saveMessage({
            threadId,
            sequence: item.sequence,
            text: item.text,
            ...(item.kind === "assistant" && item.model ? { model: item.model } : {}),
          });
      setDesktopState((state) => ({ ...state, savedMessages }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function openSavedMessage(message: SavedMessage): Promise<void> {
    if (!message.sourceAvailable) return;
    try {
      await saveDraft();
      const source = await window.desktop.openSavedMessage(message.id);
      if (!source) {
        setDesktopState((state) => ({
          ...state,
          savedMessages: state.savedMessages.map((saved) =>
            saved.id === message.id ? { ...saved, sourceAvailable: false } : saved,
          ),
        }));
        setSavedMessages((messages) => messages?.map((saved) =>
          saved.id === message.id ? { ...saved, sourceAvailable: false } : saved
        ) ?? null);
        return;
      }
      if (source.state.activeThreadId) threadTimelines.current.delete(source.state.activeThreadId);
      showDesktopState(source.state);
      scrollToEntry(source.entryId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function deleteSavedMessage(id: string): Promise<void> {
    try {
      const savedMessages = await window.desktop.deleteSavedMessage(id);
      setDesktopState((state) => ({ ...state, savedMessages }));
      setSavedMessages((messages) => messages?.filter((message) => message.id !== id) ?? null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function openBookmarkedThread(thread: DesktopThread): Promise<void> {
    try {
      await saveDraft();
      showDesktopState(await window.desktop.selectThread(thread.id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function openSearchResult(result: DesktopSearchResult): Promise<void> {
    try {
      await saveDraft();
      threadTimelines.current.delete(result.threadId);
      showDesktopState(await window.desktop.selectThread(result.threadId));
      scrollToEntry(result.entryId, "Search result no longer exists");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function openThreadSource(thread: DesktopThread): Promise<void> {
    if (!thread.sourceThreadId || !thread.sourceEntryId) return;
    const sourceExists = desktopState.workspaces.some((workspace) =>
      workspace.threads.some((candidate) => candidate.id === thread.sourceThreadId)
    );
    if (!sourceExists) {
      setError("Source thread deleted");
      return;
    }
    try {
      await saveDraft();
      threadTimelines.current.delete(thread.sourceThreadId);
      showDesktopState(await window.desktop.selectThread(thread.sourceThreadId));
      scrollToEntry(thread.sourceEntryId, "Source message deleted");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function scrollToEntry(entryId: string, missingMessage?: string): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const entry = timelineView.current
          ?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`);
        if (entry) entry.scrollIntoView({ block: "center" });
        else if (missingMessage) setError(missingMessage);
      });
    });
  }

  function scrollToTimelineItem(id: string): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        timelineView.current
          ?.querySelector<HTMLElement>(`[data-timeline-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
  }

  async function removeThreadBookmark(thread: DesktopThread): Promise<void> {
    try {
      setDesktopState(withoutConversation(await window.desktop.setThreadBookmarked(thread.id, false)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function selectTheme(themeId: string): Promise<void> {
    const theme = themeById(themeId);
    if (!theme) return;

    try {
      await window.desktop.setTheme(theme.id);
      applyTheme(theme);
      setDesktopState((state) => ({ ...state, themeId: theme.id }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setMaxSteps(maxSteps: number): Promise<void> {
    try {
      await window.desktop.setMaxSteps(maxSteps);
      setDesktopState((state) => ({ ...state, maxSteps }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setEditorFontSize(editorFontSize: number): Promise<void> {
    try {
      await window.desktop.setEditorFontSize(editorFontSize);
      setDesktopState((state) => ({ ...state, editorFontSize }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setCodeBlockFontSize(codeBlockFontSize: number): Promise<void> {
    try {
      await window.desktop.setCodeBlockFontSize(codeBlockFontSize);
      setDesktopState((state) => ({ ...state, codeBlockFontSize }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function selectModel(providerConnectionId: string, model: string): void {
    setSelectedModel(model);
    setSelectedProviderConnectionId(providerConnectionId);
    const threadId = desktopState.activeThreadId;
    setDesktopState((state) => setStateModel(state, threadId, providerConnectionId, model));
    void window.desktop.setSelectedModel(threadId, providerConnectionId, model)
      .catch((cause) => setError(errorMessage(cause)));
  }

  async function saveProviderConnection(input: ProviderConnectionInput): Promise<void> {
    setError(null);
    try {
      const state = await window.desktop.saveProviderConnection(input);
      setDesktopState(withoutConversation(state));
      await loadModels();
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }

  async function removeProviderConnection(id: string): Promise<void> {
    setError(null);
    try {
      const state = await window.desktop.removeProviderConnection(id);
      setDesktopState(withoutConversation(state));
      const selection = activeModel(state);
      setSelectedModel(selection.model);
      setSelectedProviderConnectionId(selection.providerConnectionId);
      await loadModels();
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }

  async function setTypography(interfaceFont: FontId, primaryFont: FontId, secondaryFont: FontId, codeFont: FontId): Promise<void> {
    try {
      await window.desktop.setTypography(interfaceFont, primaryFont, secondaryFont, codeFont);
      applyTypography(interfaceFont, primaryFont, secondaryFont, codeFont);
      setDesktopState((state) => ({ ...state, interfaceFont, primaryFont, secondaryFont, codeFont }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setTypographyScale(role: "interface" | "conversation", value: number): Promise<void> {
    try {
      await window.desktop.setTypographyScale(role, value);
      applyTypographyScale(role, value);
      setDesktopState((state) => ({
        ...state,
        ...(role === "interface" ? { interfaceFontScale: value } : { conversationFontScale: value }),
      }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setEditorLauncher(editorCommand: string, editorArguments: string): Promise<void> {
    try {
      await window.desktop.setEditorLauncher(editorCommand, editorArguments);
      setDesktopState((state) => ({ ...state, editorCommand, editorArguments }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function chooseEditorApplication(): Promise<void> {
    try {
      const command = await window.desktop.chooseEditorApplication();
      if (command) await setEditorLauncher(command, desktopState.editorArguments);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setProviderTimeoutMinutes(providerTimeoutMinutes: number): Promise<void> {
    try {
      await window.desktop.setProviderTimeoutMinutes(providerTimeoutMinutes);
      setDesktopState((state) => ({ ...state, providerTimeoutMinutes }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setProviderRetries(providerRetries: number): Promise<void> {
    try {
      await window.desktop.setProviderRetries(providerRetries);
      setDesktopState((state) => ({ ...state, providerRetries }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setSubagent(subagent: SubagentProfile): Promise<void> {
    try {
      await window.desktop.setSubagent(subagent);
      setDesktopState((state) => ({ ...state, subagent }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setCompaction(compactionMode: CompactionMode, compactionThreshold: number): Promise<void> {
    try {
      await window.desktop.setCompaction(compactionMode, compactionThreshold);
      setDesktopState((state) => ({ ...state, compactionMode, compactionThreshold }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setWebSearchBackend(webSearchBackend: WebSearchBackend): Promise<void> {
    try {
      await window.desktop.setWebSearchBackend(webSearchBackend);
      setDesktopState((current) => ({ ...current, webSearchBackend }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setWebSearchApiKey(backend: KetchSearchBackend, apiKey: string): Promise<void> {
    try {
      const state = await window.desktop.setWebSearchApiKey(backend, apiKey);
      setDesktopState((current) => ({ ...current, webSearchKeyBackends: state.webSearchKeyBackends }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setWebSearchEnabled(webSearchEnabled: boolean): Promise<void> {
    try {
      await window.desktop.setWebSearchEnabled(webSearchEnabled);
      setDesktopState((state) => ({ ...state, webSearchEnabled }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function beginResize(
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const otherWidth = side === "left" ? rightWidth : 0;
    const minimum = 220;

    function move(pointer: PointerEvent): void {
      const movement = side === "left" ? pointer.clientX - startX : startX - pointer.clientX;
      const limit = side === "left" ? 480 : 1200;
      const maximum = Math.max(minimum, Math.min(limit, window.innerWidth - otherWidth - 360));
      const width = Math.min(maximum, Math.max(minimum, startWidth + movement));
      if (side === "left") setLeftWidth(width);
      else setRightWidth(width);
    }

    function stop(): void {
      window.removeEventListener("pointermove", move);
      document.body.classList.remove("resizing-columns");
    }

    document.body.classList.add("resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <main className={`app-shell platform-${window.desktop.platform}`}>
      <section
        className="workspace-shell"
        style={{
          gridTemplateColumns: `${visibleLeftWidth}px minmax(360px, 1fr) ${visibleRightWidth}px`,
        }}
      >
        <Sidebar
          state={desktopState}
          runningThreadIds={desktopState.runningThreadIds}
          view={view}
          settingsPage={settingsPage}
          bookmarksPage={bookmarksPage}
          collapsed={leftCollapsed}
          beforeNavigate={saveDraft}
          onNavigate={showDesktopState}
          onUpdate={(state) => setDesktopState(withoutConversation(state))}
          onError={setError}
          onView={showView}
          onSettingsPage={(page) => {
            setSettingsPage(page);
            setError(null);
          }}
          onBookmarksPage={(page) => {
            setBookmarksPage(page);
            setError(null);
          }}
          onOpenThreadSource={(thread) => void openThreadSource(thread)}
          onCollapse={() => {
            leftAutoCollapsed.current = false;
            setLeftCollapsed(true);
          }}
        />

        {view === "settings" ? (
          <Settings
            page={settingsPage}
            themeId={desktopState.themeId}
            interfaceFont={desktopState.interfaceFont}
            primaryFont={desktopState.primaryFont}
            secondaryFont={desktopState.secondaryFont}
            codeFont={desktopState.codeFont}
            interfaceFontScale={desktopState.interfaceFontScale}
            conversationFontScale={desktopState.conversationFontScale}
            codeBlockFontSize={desktopState.codeBlockFontSize}
            editorFontSize={desktopState.editorFontSize}
            editorCommand={desktopState.editorCommand}
            editorArguments={desktopState.editorArguments}
            maxSteps={desktopState.maxSteps}
            providerTimeoutMinutes={desktopState.providerTimeoutMinutes}
            providerRetries={desktopState.providerRetries}
            subagent={desktopState.subagent}
            compactionMode={desktopState.compactionMode}
            compactionThreshold={desktopState.compactionThreshold}
            ketchAvailable={desktopState.ketchAvailable}
            openRouterAvailable={desktopState.openRouterAvailable}
            webSearchEnabled={desktopState.webSearchEnabled}
            webSearchBackend={desktopState.webSearchBackend}
            webSearchKeyBackends={desktopState.webSearchKeyBackends}
            providerConnections={desktopState.providerConnections}
            providerCatalogs={models}
            loadingProviderModels={loadingModels}
            error={error}
            onSelectTheme={(themeId) => void selectTheme(themeId)}
            onTypography={(interfaceFont, primary, secondary, code) => void setTypography(interfaceFont, primary, secondary, code)}
            onTypographyScale={(role, value) => void setTypographyScale(role, value)}
            onCodeBlockFontSize={(size) => void setCodeBlockFontSize(size)}
            onEditorFontSize={(size) => void setEditorFontSize(size)}
            onEditorLauncher={(command, argumentsTemplate) => void setEditorLauncher(command, argumentsTemplate)}
            onChooseEditor={() => void chooseEditorApplication()}
            onMaxSteps={(maxSteps) => void setMaxSteps(maxSteps)}
            onProviderTimeoutMinutes={(minutes) => void setProviderTimeoutMinutes(minutes)}
            onProviderRetries={(retries) => void setProviderRetries(retries)}
            onSubagent={(profile) => void setSubagent(profile)}
            onCompaction={(mode, threshold) => void setCompaction(mode, threshold)}
            onWebSearchEnabled={(enabled) => void setWebSearchEnabled(enabled)}
            onWebSearchBackend={(backend) => void setWebSearchBackend(backend)}
            onWebSearchApiKey={(backend, apiKey) => void setWebSearchApiKey(backend, apiKey)}
            onSaveProvider={saveProviderConnection}
            onRemoveProvider={removeProviderConnection}
            onTestProvider={(id) => window.desktop.getProviderStatus(id)}
          />
        ) : view === "saved" ? (
          <Bookmarks
            workspaces={desktopState.workspaces}
            messages={savedMessages ?? []}
            page={bookmarksPage}
            loadingMessages={savedMessages === null}
            onOpenThread={(thread) => void openBookmarkedThread(thread)}
            onRemoveThread={(thread) => void removeThreadBookmark(thread)}
            onOpenMessage={(message) => void openSavedMessage(message)}
            onDeleteMessage={(id) => void deleteSavedMessage(id)}
          />
        ) : view === "search" ? (
          <Search
            onOpen={(result) => void openSearchResult(result)}
            onError={setError}
          />
        ) : (
          <section className="conversation view-enter" aria-label="Conversation">
          <div
            ref={timelineView}
            className="timeline"
            aria-live="polite"
            onScroll={(event) => {
              const view = event.currentTarget;
              followTimeline.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80;
            }}
          >
            {timeline.map((item) => (
              <TimelineEntry
                key={item.id}
                item={item}
                previousModel={previousAssistantModels.get(item.id)}
                selectedId={selectedItemId}
                onSelect={(id) => {
                  setSelectedItemId(id);
                  setInspectorTab("inspect");
                  setRightCollapsed(false);
                }}
                onResolveApproval={(id, decision) => void resolveCommandApproval(id, decision)}
                savedId={
                  item.kind === "assistant"
                    ? savedIdFor(item)
                    : undefined
                }
                onToggleSaved={(message, savedId) => void toggleSavedMessage(message, savedId)}
                {...(!running
                  ? { onToggleAttachmentContext: (message, attachment) => void toggleAttachmentContext(message, attachment) }
                  : {})}
                onEditUser={(text) => {
                  setTask(text);
                  window.requestAnimationFrame(() => {
                    const input = taskInput.current;
                    input?.focus();
                    input?.setSelectionRange(text.length, text.length);
                  });
                }}
                {...(!running ? { onRestore: (sequence) => void restoreThread(sequence) } : {})}
                {...(!running ? { onFork: (sequence) => void forkThread(sequence) } : {})}
              />
            ))}
          </div>

          <AttachmentTray
            activeAttachments={activeContextAttachments}
            pendingAttachments={pendingAttachments}
            estimatedTokens={attachmentTokens}
            tooLarge={attachmentsTooLarge}
            onRemoveActive={removeActiveAttachment}
            onRemovePending={(attachment) => void removeAttachment(attachment)}
          />
          <Composer
            task={task}
            taskInput={taskInput}
            executionMode={executionMode}
            composerAdd={composerAdd}
            dragging={draggingAttachments}
            running={running}
            pendingAttachmentCount={pendingAttachments.length}
            models={models}
            selectedProviderConnectionId={selectedProviderConnectionId}
            selectedModel={selectedModel}
            loadingModels={loadingModels}
            providerAvailable={desktopState.providerConnections.some((connection) => connection.enabled)}
            contextReport={contextReport}
            pendingContextTokens={pendingContextTokens}
            compactingContext={compactingContext}
            unsafe={unsafeHostExecution}
            restrictedDetail={desktopState.restrictedHostDetail}
            orbMotion={sendOrbMotion}
            blocker={runBlocker}
            error={error}
            platform={window.desktop.platform}
            onTask={setTask}
            onSubmit={(event) => void startRun(event)}
            onDragging={setDraggingAttachments}
            onDrop={(event) => void dropAttachments(event)}
            onPaste={(event) => void pasteIntoTask(event)}
            onPastePlain={() => void pastePlainText()}
            onPasteMarkdown={() => void pasteMarkdown()}
            onChooseAttachments={() => void chooseAttachments()}
            onModel={selectModel}
            onCompact={() => void compactCurrentContext()}
            onUnsafe={(value) => void setThreadUnsafe(value)}
            onStop={() => void stopRun()}
          />
          </section>
        )}

        <aside
          className={view !== "conversation" || rightCollapsed ? "inspector collapsed" : "inspector"}
          aria-label="Context panel"
          aria-hidden={view !== "conversation" || rightCollapsed}
        >
          {view === "conversation" && !rightCollapsed ? (
            <InspectorPanel
              workspace={desktopState.workspace}
              selectedItem={selectedItem}
              timeline={timeline}
              running={running}
              selectedModel={selectedModel}
              selectedProviderConnectionId={selectedProviderConnectionId}
              providerNames={Object.fromEntries(desktopState.providerConnections.map((connection) => [connection.id, connection.name]))}
              modelInstructions={desktopState.modelInstructions}
              toolSpecs={desktopState.toolSpecs}
              tab={inspectorTab}
              onTab={setInspectorTab}
              onSelect={setSelectedItemId}
              onNavigateTurn={scrollToTimelineItem}
              onEditorOpen={expandFileEditor}
              onCollapse={() => {
                expandFileEditor(false);
                setRightCollapsed(true);
              }}
            />
          ) : null}
        </aside>

        {leftCollapsed ? (
          <button
            className="panel-reopen left"
            type="button"
            onClick={() => {
              expandFileEditor(false);
              leftAutoCollapsed.current = false;
              setLeftCollapsed(false);
            }}
            aria-label="Show workspace sidebar"
            title="Show sidebar"
          >
            <span className="pane-icon left" aria-hidden="true" />
          </button>
        ) : (
          <div
            className="column-resizer left-resizer"
            style={{ left: leftWidth }}
            role="separator"
            aria-label="Resize workspace sidebar"
            aria-orientation="vertical"
            onPointerDown={(event) => beginResize("left", event)}
          />
        )}
        {view !== "conversation" ? null : rightCollapsed ? (
          <button
            className="panel-reopen right"
            type="button"
            onClick={() => setRightCollapsed(false)}
            aria-label="Show right panel"
            title="Show right panel"
          >
            <span className="pane-icon right" aria-hidden="true" />
          </button>
        ) : fileEditorExpanded.current ? null : (
          <div
            className="column-resizer right-resizer"
            style={{ right: rightWidth }}
            role="separator"
            aria-label="Resize right panel"
            aria-orientation="vertical"
            onPointerDown={(event) => beginResize("right", event)}
          />
        )}
      </section>
    </main>
  );
}

function focusedEditorWidth(): number {
  return Math.max(320, Math.min(window.innerWidth * 0.65, window.innerWidth - 360));
}

function mergeStreamEvent(previous: DesktopRunEvent, next: DesktopRunEvent): boolean {
  if (previous.threadId !== next.threadId) return false;
  if (
    previous.event.type === "model.delta" &&
    next.event.type === "model.delta" &&
    previous.event.step === next.event.step
  ) {
    previous.event.text += next.event.text;
    return true;
  }
  if (
    previous.event.type === "model.reasoning.delta" &&
    next.event.type === "model.reasoning.delta" &&
    previous.event.step === next.event.step
  ) {
    previous.event.text += next.event.text;
    return true;
  }
  if (
    previous.event.type === "model.tool.delta" &&
    next.event.type === "model.tool.delta" &&
    previous.event.step === next.event.step &&
    previous.event.index === next.event.index
  ) {
    previous.event.name = next.event.name;
    previous.event.argumentChars = next.event.argumentChars;
    return true;
  }
  return false;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.appearance = theme.appearance;
  document.documentElement.dataset.accentedTheme = String(Boolean(theme.accented));
  document.documentElement.style.colorScheme = theme.appearance;
  for (const [name, value] of Object.entries(theme.colors)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
}

function applyTypography(interfaceFont: FontId, primary: FontId, secondary: FontId, code: FontId): void {
  for (const [role, id] of Object.entries({ interface: interfaceFont, primary, secondary, code })) {
    const font = fontById(id);
    if (!font) continue;
    document.documentElement.dataset[`${role}Font`] = font.id;
    document.documentElement.style.setProperty(`--font-${role}`, font.family);
  }
}

function applyTypographyScale(role: "interface" | "conversation", value: number): void {
  document.documentElement.dataset[`${role}FontScale`] = String(value);
  const baseline = role === "conversation" ? CONVERSATION_FONT_BASE : 1;
  document.documentElement.style.setProperty(`--${role}-font-scale`, String(value / 100 * baseline));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function activeDraft(state: DesktopState): string {
  return state.workspace?.threads.find((thread) => thread.id === state.activeThreadId)?.draft ?? "";
}

function activeModel(state: DesktopState): { providerConnectionId: string; model: string } {
  const thread = state.workspace?.threads.find((thread) => thread.id === state.activeThreadId);
  return {
    providerConnectionId: thread?.model
      ? thread.providerConnectionId
      : state.defaultProviderConnectionId,
    model: thread?.model ?? state.defaultModel ?? "",
  };
}

function setStateModel(
  state: DesktopState,
  threadId: string | null,
  providerConnectionId: string,
  model: string,
): DesktopState {
  const updateWorkspace = (workspace: DesktopState["workspace"]): DesktopState["workspace"] => workspace
    ? {
        ...workspace,
        threads: workspace.threads.map((thread) => thread.id === threadId
          ? { ...thread, providerConnectionId, model }
          : thread),
      }
    : null;
  return {
    ...state,
    defaultModel: model,
    defaultProviderConnectionId: providerConnectionId,
    workspace: updateWorkspace(state.workspace),
    workspaces: state.workspaces.map((workspace) => updateWorkspace(workspace)!),
  };
}

function modelTransitions(items: TimelineItem[]): Map<string, string> {
  const transitions = new Map<string, string>();
  let previous: string | undefined;
  for (const item of items) {
    if (item.kind !== "assistant" || item.intermediate || item.streaming || !item.model) continue;
    if (previous && previous !== item.model) transitions.set(item.id, previous);
    previous = item.model;
  }
  return transitions;
}

function withoutConversation(state: DesktopState): DesktopState {
  return state.conversation.length || state.contextCheckpoints.length
    ? { ...state, conversation: [], contextCheckpoints: [] }
    : state;
}

function trimThreadTimelines(
  timelines: Map<string, TimelineItem[]>,
  activeId: string | null,
  runningIds: string[],
): void {
  const retained = new Set(runningIds);
  if (activeId) retained.add(activeId);
  for (const threadId of timelines.keys()) {
    if (!retained.has(threadId)) timelines.delete(threadId);
  }
}

function nextMessageSequence(items: TimelineItem[]): number {
  let highest = 0;
  for (const item of items) {
    if (item.kind === "activity-group") {
      highest = Math.max(highest, nextMessageSequence(item.items) - 1);
    } else if ("sequence" in item && item.sequence !== undefined) {
      highest = Math.max(highest, item.sequence);
    }
  }
  return highest + 1;
}

function attachmentRef(attachment: AttachmentPreview): AttachmentRef {
  const { fingerprint: _fingerprint, thumbnail: _thumbnail, ...reference } = attachment;
  return reference;
}
