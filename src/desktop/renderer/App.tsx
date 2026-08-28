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
import type { ImageUnderstandingProfile } from "../../attachments/vision.js";
import type { CommandApprovalDecision } from "../../protocol.js";
import {
  MAX_KEPT_ASIDE_MESSAGES,
  type CodeSelectionInput,
  type DesktopApi,
  type DesktopRunEvent,
  type DesktopSearchResult,
  type DesktopState,
  type DesktopThread,
  type DesktopUpdateState,
  type GitWalkthroughResult,
  type WalkthroughModelSetting,
  type StartRunInput,
  type SavedMessage,
} from "../api.js";
import type {
  ProviderAllowance,
  ProviderCatalog,
  ProviderConnectionInput,
  ProviderStatus,
  ReasoningEffort,
} from "../../providers/provider.js";
import type { CompactionMode } from "../../context/budget.js";
import type { SubagentProfile, ThreadSubagentMode } from "../../agent/subagents/profile.js";
import type { ContextReport } from "../../context/report.js";
import type { KetchSearchBackend, WebSearchBackend } from "../../tools/web/types.js";
import type { McpServerConfig, McpServerStatus } from "../../mcp/types.js";
import {
  activeToolNamesForSurface,
  modelSurfaceKey,
  surfaceForModel,
  type ModelToolSurface,
} from "../../capabilities/surface.js";
import { DEFAULT_MODEL_CONTEXT_LENGTH } from "../../providers/provider.js";
import { applyModelVariant, providerProfile, splitModelVariant } from "../../providers/profiles.js";
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
import { Onboarding } from "./screens/onboarding/onboarding.js";
import { Bookmarks, type BookmarksPage } from "./screens/bookmarks/bookmarks.js";
import { Search } from "./screens/search/search.js";
import { Sidebar, type AppView, type SettingsPage } from "./sections/sidebar/sidebar.js";
import {
  InspectorPanel,
  type ChangesTurnRequest,
  type FileEditorRequest,
  type InspectorTab,
} from "./sections/inspector/panel.js";
import type { OrbMotion } from "./components/thinking-orb.js";
import { Composer } from "./sections/conversation/composer.js";
import type { SandboxAccessInput } from "../../execution/access.js";
import type { RestrictedEngine } from "../../execution/workspace.js";
import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "../../speech/config.js";
import type { SpeechModel, SpeechModelStatus } from "../../speech/config.js";
import { AsideShelf } from "./sections/conversation/aside-shelf.js";
import { CommandPalette, type AppCommand } from "./commands/palette.js";
import { TerminalPanel } from "./sections/terminal/terminal.js";
import {
  ActivePlan,
  TimelineEntry,
} from "./sections/conversation/timeline.js";
import {
  fileChangeSummaries,
  latestToolPreviewId,
} from "./sections/conversation/file-tool-preview.js";
import {
  addRunEvent,
  findTimelineItem,
  modelCallsForReasoning,
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
  onboardingComplete: true,
  workspace: null,
  workspaces: [],
  activeThreadId: null,
  conversation: [],
  contextCheckpoints: [],
  modelInstructions: [],
  toolSpecs: [],
  modelTools: [],
  systemPrompt: "",
  runtimeMetadata: "",
  disabledTools: [],
  modelToolSurfaces: {},
  skills: [],
  savedMessages: [],
  keptAside: [],
  providerConnections: [],
  mcpEnabled: true,
  mcpServers: [],
  openRouterAvailable: false,
  deepSeekAvailable: false,
  ketchAvailable: false,
  webSearchEnabled: false,
  webSearchBackend: "ddg",
  webSearchKeyBackends: [],
  runningThreadIds: [],
  unsafeThreadIds: [],
  sandboxAccess: [],
  defaultModel: null,
  defaultProviderConnectionId: "openrouter",
  restrictedHostAvailable: false,
  restrictedHostDetail: "Checking restricted execution…",
  restrictedEngine: window.desktop.platform === "win32" ? "microsandbox" : "native",
  microsandboxAvailable: false,
  microsandboxDetail: "Checking Microsandbox…",
  themeId: document.documentElement.dataset.theme ?? DEFAULT_THEME.id,
  animationsEnabled: document.documentElement.dataset.animations !== "off",
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
  walkthroughModel: { providerConnectionId: "", model: "" },
  maxSteps: 50,
  autoTitleGeneration: true,
  sandboxNetworkEnabled: true,
  providerTimeoutMinutes: 3,
  providerRetries: 4,
  subagent: {
    enabled: false,
    modelMode: "main",
    providerConnectionId: "",
    model: "",
    overflowProviderConnectionId: "",
    overflowModel: "",
    maxSteps: 50,
  },
  imageUnderstanding: {
    enabled: false,
    providerConnectionId: "",
    model: "",
  },
  speech: DEFAULT_SPEECH_SETTINGS,
  speechModels: [],
  compactionMode: "automatic",
  compactionThreshold: 65,
};

const initialUpdateState: DesktopUpdateState = {
  status: "disabled",
  currentVersion: "",
  automatic: false,
};

type QueuedFollowUp = {
  request: StartRunInput;
  attachments: AttachmentPreview[];
};

export function App(): JSX.Element {
  const [desktopState, setDesktopState] = useState(initialState);
  const [updateState, setUpdateState] = useState(initialUpdateState);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [savedMessages, setSavedMessages] = useState<SavedMessage[] | null>(null);
  const [models, setModels] = useState<ProviderCatalog[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | "">("");
  const [selectedProviderConnectionId, setSelectedProviderConnectionId] = useState("openrouter");
  const [providerAllowances, setProviderAllowances] = useState<Record<string, ProviderAllowance | null>>({});
  const [task, setTask] = useState("");
  const speechDraft = useRef({ prefix: "", suffix: "" });
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentPreview[]>([]);
  const [draggingAttachments, setDraggingAttachments] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(270);
  const [rightWidth, setRightWidth] = useState(328);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("inspect");
  const [fileEditorRequest, setFileEditorRequest] = useState<FileEditorRequest | null>(null);
  const [changesTurnRequest, setChangesTurnRequest] = useState<ChangesTurnRequest | null>(null);
  const [gitRepositoryReady, setGitRepositoryReady] = useState(false);
  const [gitWalkthrough, setGitWalkthrough] = useState<{
    workspaceId: string;
    result: GitWalkthroughResult;
    open: boolean;
  } | null>(null);
  const [view, setView] = useState<AppView>("conversation");
  const [commandMode, setCommandMode] = useState<"all" | "slash" | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  const [bookmarksPage, setBookmarksPage] = useState<BookmarksPage>("threads");
  const [sendOrbMotion, setSendOrbMotion] = useState<OrbMotion>("stopped");
  const [providerWaits, setProviderWaits] = useState<Record<string, string>>({});
  const [preparingThreadIds, setPreparingThreadIds] = useState<string[]>([]);
  const [contextReport, setContextReport] = useState<ContextReport | null>(null);
  const [contextRefresh, setContextRefresh] = useState(0);
  const [compactingContext, setCompactingContext] = useState(false);
  const [explicitlyActiveTools, setExplicitlyActiveTools] = useState<string[]>([]);
  const [, refreshQueuedFollowUps] = useState(0);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const timelineView = useRef<HTMLDivElement>(null);
  const timelineContent = useRef<HTMLDivElement>(null);
  const timelineScrollTop = useRef(0);
  const executionMode = useRef<HTMLDetailsElement>(null);
  const composerAdd = useRef<HTMLDetailsElement>(null);
  const searchOpenedAt = useRef(0);
  const terminalUnmountTimer = useRef<number | undefined>(undefined);
  const runProviderConnections = useRef<Record<string, string>>({});

  const refreshProviderAllowance = useCallback(async (connectionId: string): Promise<void> => {
    try {
      const allowance = await window.desktop.getProviderAllowance(connectionId);
      setProviderAllowances((current) => ({ ...current, [connectionId]: allowance }));
    } catch {
      setProviderAllowances((current) => ({ ...current, [connectionId]: null }));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void window.desktop.getUpdateState()
      .then((state) => {
        if (active) setUpdateState(state);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
    const unsubscribe = window.desktop.onUpdateState(setUpdateState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => window.desktop.onSpeechModelStatus((status: SpeechModelStatus) => {
    setDesktopState((current) => ({
      ...current,
      speechModels: current.speechModels.some((model) => model.id === status.id)
        ? current.speechModels.map((model) => model.id === status.id ? status : model)
        : [...current.speechModels, status],
    }));
  }), []);

  useEffect(() => window.desktop.onSpeechTranscript((event) => {
    if (event.error) {
      setError(event.error);
      return;
    }
    const transcript = event.text.trim();
    if (!transcript) return;
    const { prefix, suffix } = speechDraft.current;
    const before = prefix && !/\s$/.test(prefix) ? " " : "";
    const after = suffix && !/^[\s.,!?;:)\]}]/.test(suffix) ? " " : "";
    setTask(`${prefix}${before}${transcript}${after}${suffix}`);
    const caret = prefix.length + before.length + transcript.length;
    requestAnimationFrame(() => taskInput.current?.setSelectionRange(caret, caret));
  }), []);

  async function checkForUpdates(): Promise<void> {
    try {
      setError(null);
      setUpdateState(await window.desktop.checkForUpdates());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function applyUpdate(): Promise<void> {
    try {
      setError(null);
      await window.desktop.applyUpdate();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  useEffect(() => {
    if (!stateLoaded) return;
    const connection = desktopState.providerConnections.find(
      (item) => item.id === selectedProviderConnectionId,
    );
    if (!connection || !providerProfile(connection.providerId).providesAllowance) return;
    const timeout = window.setTimeout(() => {
      void refreshProviderAllowance(connection.id);
    }, 4500);
    return () => window.clearTimeout(timeout);
  }, [desktopState.providerConnections, refreshProviderAllowance, selectedProviderConnectionId, stateLoaded]);

  function showTerminal(): void {
    if (!desktopState.workspace) return;
    if (terminalUnmountTimer.current) window.clearTimeout(terminalUnmountTimer.current);
    setTerminalMounted(true);
    window.requestAnimationFrame(() => setTerminalOpen(true));
  }

  function hideTerminal(): void {
    setTerminalOpen(false);
    if (terminalUnmountTimer.current) window.clearTimeout(terminalUnmountTimer.current);
    terminalUnmountTimer.current = window.setTimeout(() => setTerminalMounted(false), 180);
  }

  function toggleTerminal(): void {
    if (view === "conversation" && terminalOpen) {
      hideTerminal();
      return;
    }
    setView("conversation");
    showTerminal();
  }

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

  useEffect(() => {
    function toggleCommands(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setCommandMode((current) => current === "all" ? null : "all");
    }

    window.addEventListener("keydown", toggleCommands);
    return () => window.removeEventListener("keydown", toggleCommands);
  }, []);

  useEffect(() => {
    function handleTerminalShortcut(event: KeyboardEvent): void {
      if (!event.ctrlKey || event.code !== "Backquote") return;
      event.preventDefault();
      if (!desktopState.workspace) return;
      toggleTerminal();
    }

    window.addEventListener("keydown", handleTerminalShortcut);
    return () => window.removeEventListener("keydown", handleTerminalShortcut);
  }, [desktopState.workspace, terminalOpen, view]);

  useEffect(() => () => {
    if (terminalUnmountTimer.current) window.clearTimeout(terminalUnmountTimer.current);
  }, []);
  const followTimeline = useRef(true);
  const leftAutoCollapsed = useRef(false);
  const rightPanelFocused = useRef(false);
  const inspectorTabValue = useRef<InspectorTab>(inspectorTab);
  const gitDetailOpen = useRef(false);
  const fileEditorRequestId = useRef(0);
  const changesTurnRequestId = useRef(0);
  const layoutBeforeRightPanelFocus = useRef<{
    rightWidth: number;
    leftCollapsed: boolean;
    leftAutoCollapsed: boolean;
  } | null>(null);
  const rightWidthValue = useRef(rightWidth);
  const leftCollapsedValue = useRef(leftCollapsed);
  const activeThreadId = useRef<string | null>(null);
  const threadTimelines = useRef(new Map<string, TimelineItem[]>());
  const threadAttachments = useRef(new Map<string, AttachmentPreview[]>());
  const queuedFollowUps = useRef(new Map<string, QueuedFollowUp>());
  rightWidthValue.current = rightWidth;
  leftCollapsedValue.current = leftCollapsed;
  inspectorTabValue.current = inspectorTab;
  const running = desktopState.activeThreadId
    ? desktopState.runningThreadIds.includes(desktopState.activeThreadId)
    : false;
  const preparing = desktopState.activeThreadId
    ? preparingThreadIds.includes(desktopState.activeThreadId)
    : false;
  const queuedFollowUp = desktopState.activeThreadId
    ? queuedFollowUps.current.get(desktopState.activeThreadId) ?? null
    : null;
  const unsafeHostExecution = desktopState.activeThreadId
    ? desktopState.unsafeThreadIds.includes(desktopState.activeThreadId)
    : false;

  const setRightPanelFocus = useCallback((focused: boolean): void => {
    if (rightPanelFocused.current === focused) return;
    rightPanelFocused.current = focused;

    if (focused) {
      layoutBeforeRightPanelFocus.current = {
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

    const previous = layoutBeforeRightPanelFocus.current;
    layoutBeforeRightPanelFocus.current = null;
    if (!previous) return;
    leftAutoCollapsed.current = previous.leftAutoCollapsed;
    setRightWidth(previous.rightWidth);
    setLeftCollapsed(previous.leftCollapsed);
  }, []);

  const hideRightPanel = useCallback((): void => {
    setRightPanelFocus(false);
    if (leftAutoCollapsed.current) {
      leftAutoCollapsed.current = false;
      setLeftCollapsed(false);
    }
    setRightCollapsed(true);
  }, [setRightPanelFocus]);

  const selectInspectorTab = useCallback((tab: InspectorTab): void => {
    inspectorTabValue.current = tab;
    setInspectorTab(tab);
    setRightPanelFocus(tab === "git" && gitDetailOpen.current);
  }, [setRightPanelFocus]);

  const handleGitDetailOpen = useCallback((open: boolean): void => {
    gitDetailOpen.current = open;
    if (inspectorTabValue.current === "git") setRightPanelFocus(open);
  }, [setRightPanelFocus]);

  const openBuiltInFileEditor = useCallback((path: string): void => {
    const workspaceId = desktopState.workspace?.id;
    if (!workspaceId) return;
    fileEditorRequestId.current += 1;
    setFileEditorRequest({ workspaceId, path, requestId: fileEditorRequestId.current });
    selectInspectorTab("git");
    setRightCollapsed(false);
  }, [desktopState.workspace?.id, selectInspectorTab]);

  const reviewAgentChanges = useCallback((turnId: string): void => {
    changesTurnRequestId.current += 1;
    setChangesTurnRequest({ turnId, requestId: changesTurnRequestId.current });
    selectInspectorTab("changes");
    setRightPanelFocus(true);
    setRightCollapsed(false);
  }, [selectInspectorTab, setRightPanelFocus]);

  useEffect(() => {
    const workspace = desktopState.workspace;
    let current = true;
    setGitRepositoryReady(false);
    setGitWalkthrough(null);
    if (workspace) {
      void window.desktop.getGitChanges(workspace.id).then(
        (changes) => { if (current) setGitRepositoryReady(changes.state === "ready"); },
        () => { if (current) setGitRepositoryReady(false); },
      );
      void window.desktop.getGitWalkthrough(workspace.id).then(
        (result) => {
          if (current && result) setGitWalkthrough({ workspaceId: workspace.id, result, open: false });
        },
        (cause) => { if (current) setError(errorMessage(cause)); },
      );
    }
    return () => { current = false; };
  }, [desktopState.workspace?.id]);

  useLayoutEffect(() => {
    const input = taskInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [task]);

  useLayoutEffect(() => {
    const view = timelineView.current;
    if (view && followTimeline.current) {
      view.scrollTop = view.scrollHeight;
      setShowJumpToLatest(false);
    }
  }, [timeline]);

  useLayoutEffect(() => {
    const timeline = timelineView.current;
    const content = timelineContent.current;
    if (view !== "conversation" || !timeline || !content) return;
    const observer = new ResizeObserver(() => {
      if (!followTimeline.current) return;
      timeline.scrollTop = timeline.scrollHeight;
      setShowJumpToLatest(false);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [view]);

  useLayoutEffect(() => {
    if (view !== "conversation") return;
    const timeline = timelineView.current;
    if (!timeline) return;
    timeline.scrollTop = followTimeline.current
      ? timeline.scrollHeight
      : timelineScrollTop.current;
  }, [view]);

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
    applyAnimationsEnabled(desktopState.animationsEnabled);
  }, [desktopState.animationsEnabled]);

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

      if (rightPanelFocused.current) {
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

    function launchQueuedFollowUp(threadId: string, queued: QueuedFollowUp): void {
      queuedFollowUps.current.delete(threadId);
      refreshQueuedFollowUps((value) => value + 1);
      void submitPreparedTask(queued).then((started) => {
        if (started || activeThreadId.current === threadId) return;
        queuedFollowUps.current.set(threadId, queued);
        refreshQueuedFollowUps((value) => value + 1);
      });
    }

    function applyRunEvent({ threadId, event }: DesktopRunEvent): void {
      const queued = event.type === "run.persisted"
        ? queuedFollowUps.current.get(threadId)
        : undefined;
      if (event.type === "run.persisted" && activeThreadId.current !== threadId) {
        threadTimelines.current.delete(threadId);
        if (queued) launchQueuedFollowUp(threadId, queued);
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

      if (event.type === "provider.waiting") {
        setProviderWaits((current) => ({
          ...current,
          [threadId]: `${event.connectionName} is busy · ${event.active} of ${event.limit} generations active`,
        }));
      }
      if (event.type === "provider.ready") {
        setProviderWaits((current) => withoutKey(current, threadId));
      }

      if (event.type === "run.started") {
        setPreparingThreadIds((current) => current.filter((id) => id !== threadId));
        runProviderConnections.current[threadId] = event.providerConnectionId;
        setProviderWaits((current) => withoutKey(current, threadId));
        setDesktopState((state) => ({
          ...state,
          runningThreadIds: [...new Set([...state.runningThreadIds, threadId])],
          ...(activeThreadId.current === threadId && event.instructions?.length
            ? { modelInstructions: event.instructions }
            : {}),
        }));
      }
      if (event.type === "run.completed" || event.type === "run.failed") {
        setPreparingThreadIds((current) => current.filter((id) => id !== threadId));
        const connectionId = runProviderConnections.current[threadId];
        delete runProviderConnections.current[threadId];
        if (connectionId) void refreshProviderAllowance(connectionId);
        setProviderWaits((current) => withoutKey(current, threadId));
        setDesktopState((state) => ({
          ...state,
          runningThreadIds: state.runningThreadIds.filter((id) => id !== threadId),
        }));
      }
      if (event.type === "thread.title.generated") {
        setDesktopState((state) => ({
          ...state,
          workspace: state.workspace
            ? {
                ...state.workspace,
                threads: state.workspace.threads.map((thread) =>
                  thread.id === threadId ? { ...thread, title: event.title } : thread
                ),
              }
            : null,
          workspaces: state.workspaces.map((workspace) => ({
            ...workspace,
            threads: workspace.threads.map((thread) =>
              thread.id === threadId ? { ...thread, title: event.title } : thread
            ),
          })),
        }));
      }
      if (event.type === "run.persisted" || event.type.startsWith("context.")) {
        setContextRefresh((value) => value + 1);
      }
      if (queued) launchQueuedFollowUp(threadId, queued);
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
        setSelectedReasoningEffort(selection.reasoningEffort);
        setOnboardingOpen(!state.onboardingComplete);
        void loadModels();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setStateLoaded(true));

    const unsubscribe = window.desktop.onRunEvent((event) => {
      const previous = queuedEvents.at(-1);
      if (!previous || !mergeStreamEvent(previous, event)) queuedEvents.push(event);
      flushTimer ??= window.setTimeout(flushEvents, 16);
    });

    return () => {
      unsubscribe();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    };
  }, [refreshProviderAllowance]);

  const selectedItem = useMemo(
    () => findTimelineItem(timeline, selectedItemId),
    [selectedItemId, timeline],
  );
  const reasoningModelCalls = useMemo(() => modelCallsForReasoning(timeline), [timeline]);
  const previousAssistantModels = useMemo(() => modelTransitions(timeline), [timeline]);
  const answerFileChanges = useMemo(() => fileChangeSummaries(timeline), [timeline]);
  const activeToolPreviewId = useMemo(
    () => running ? latestToolPreviewId(timeline) : null,
    [running, timeline],
  );
  const currentTurnItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (!item || item.kind === "user") break;
      ids.add(item.id);
    }
    return ids;
  }, [timeline]);
  const visibleLeftWidth = leftCollapsed ? 0 : leftWidth;
  const visibleRightWidth = view !== "conversation" || rightCollapsed ? 0 : rightWidth;
  const terminalVisible = view === "conversation" && terminalOpen && Boolean(desktopState.workspace);
  const activeThread = desktopState.workspace?.threads.find(
    (thread) => thread.id === desktopState.activeThreadId,
  );
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

  useEffect(() => {
    if (!stateLoaded || !selectedModel || !selectedCatalog || selectedCatalog.error || selectedProviderModel) return;
    const selection = splitModelVariant(selectedModel, selectedProfile?.modelVariants);
    const repairedModel = uniqueCatalogModelMatch(selectedCatalog, selection.baseModelId);
    if (!repairedModel) return;
    selectModel(
      selectedProviderConnectionId,
      applyModelVariant(repairedModel, selection.variantId, selectedProfile?.modelVariants),
    );
  }, [models, selectedModel, selectedProviderConnectionId, stateLoaded]);

  const effectiveReasoningEffort = selectedReasoningEffort &&
    selectedProviderModel?.reasoning?.efforts.includes(selectedReasoningEffort)
    ? selectedReasoningEffort
    : "";
  const availableToolNames = desktopState.modelTools
    .filter((tool) => tool.available && tool.enabled)
    .map((tool) => tool.name);
  const toolSurface = surfaceForModel(
    desktopState.modelToolSurfaces,
    selectedProviderConnectionId,
    selectedModel,
    availableToolNames,
  );
  const explicitTools = [
    ...explicitlyActiveTools,
    ...(availableToolNames.includes("delegate_task") ? ["delegate_task"] : []),
  ];
  const activeToolNames = activeToolNamesForSurface(availableToolNames, toolSurface, explicitTools);
  const selectedContextLength = selectedProviderModel?.contextLength ??
    DEFAULT_MODEL_CONTEXT_LENGTH;
  const pendingContextTokens = Math.ceil(task.length / 4) + pendingAttachments.reduce(
    (total, attachment) => total + attachment.estimatedTokens,
    0,
  );
  const selectedModalities = selectedProviderModel?.inputModalities;
  const imageUnsupported = contextAttachments.some((attachment) => attachment.kind === "image") &&
    selectedModalities !== undefined && !selectedModalities.includes("image");
  const imageUnderstandingReady = desktopState.imageUnderstanding.enabled &&
    Boolean(desktopState.imageUnderstanding.providerConnectionId) &&
    Boolean(desktopState.imageUnderstanding.model);
  const attachmentsTooLarge = attachmentTokens > selectedContextLength * 0.7;
  const microsandboxBlocker = window.desktop.platform === "win32" &&
    desktopState.microsandboxDetail.startsWith("Enable Windows Hypervisor Platform")
    ? "You are in restricted mode. To continue without a sandbox, click Restricted and select ‘Allow unrestricted shell commands.’ To use the sandbox on Windows, enable Windows Hypervisor Platform in ‘Turn Windows features on or off,’ restart Windows, and ensure hardware virtualization is enabled in UEFI/BIOS."
    : desktopState.microsandboxDetail;
  const runBlocker = !desktopState.workspace
    ? "Open a workspace before sending."
    : !task.trim() && pendingAttachments.length === 0
      ? "Describe a task or attach a file before sending."
      : !selectedModel || !selectedCatalog
        ? "Select a model before sending."
        : selectedCatalog.error && selectedCatalog.models.length === 0
          ? "The selected provider connection is unavailable."
        : !selectedProviderModel
          ? "Select an available model before sending."
        : selectedProviderModel.toolUseUnavailableReason
          ? selectedProviderModel.toolUseUnavailableReason
        : attachmentsTooLarge
          ? "Attachments are too large for the selected model context."
          : imageUnsupported && !imageUnderstandingReady
            ? "The selected model does not accept images. Configure Image understanding in Agent settings."
            : !unsafeHostExecution && desktopState.restrictedEngine === "native" && !desktopState.restrictedHostAvailable
              ? desktopState.restrictedHostDetail
            : !unsafeHostExecution && desktopState.restrictedEngine === "microsandbox" && !desktopState.microsandboxAvailable
              ? microsandboxBlocker
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

    if (preparing) return;
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

    const message = task.trim();
    if (!message) return;
    await submitTask(threadId, message, pendingAttachments, explicitlyActiveTools);
  }

  async function submitTask(
    threadId: string,
    message: string,
    attachments: AttachmentPreview[],
    activeTools: string[],
  ): Promise<void> {
    await submitPreparedTask(prepareRunRequest(threadId, message, attachments, activeTools));
  }

  function prepareRunRequest(
    threadId: string,
    message: string,
    attachments: AttachmentPreview[],
    activeTools: string[],
  ): QueuedFollowUp {
    const request: StartRunInput = {
      threadId,
      task: message,
      providerConnectionId: selectedProviderConnectionId,
      model: selectedModel,
      ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
      contextLength: selectedContextLength,
      imageInputSupported: selectedModalities?.includes("image") !== false,
      ...(attachments.length
        ? { attachments: attachments.map(attachmentRef) }
        : {}),
      ...(activeTools.length ? { explicitlyActiveTools: activeTools } : {}),
    };

    return { request, attachments };
  }

  async function submitPreparedTask(followUp: QueuedFollowUp): Promise<boolean> {
    const { request, attachments } = followUp;
    const active = activeThreadId.current === request.threadId;

    if (active) followTimeline.current = true;
    appendUserMessage(request.threadId, request.task, attachments);
    if (active) {
      setTask("");
      setPendingAttachments([]);
      setExplicitlyActiveTools([]);
    }
    threadAttachments.current.delete(request.threadId);
    setDesktopState((state) => ({
      ...state,
      runningThreadIds: [...new Set([...state.runningThreadIds, request.threadId])],
    }));
    setPreparingThreadIds((current) => [...new Set([...current, request.threadId])]);
    setProviderWaits((current) => withoutKey(current, request.threadId));

    try {
      await window.desktop.startRun(request);
      setPreparingThreadIds((current) => current.filter((id) => id !== request.threadId));
    } catch (cause) {
      setPreparingThreadIds((current) => current.filter((id) => id !== request.threadId));
      setProviderWaits((current) => withoutKey(current, request.threadId));
      setDesktopState((state) => ({
        ...state,
        runningThreadIds: state.runningThreadIds.filter((id) => id !== request.threadId),
      }));
      if (active) {
        setTask(request.task);
        setPendingAttachments(attachments);
        setExplicitlyActiveTools(request.explicitlyActiveTools ?? []);
      }
      threadAttachments.current.set(request.threadId, attachments);
      setError(errorMessage(cause));
      return false;
    }
    return true;
  }

  function queueFollowUp(): void {
    const threadId = desktopState.activeThreadId;
    const message = task.trim();
    if (!running || !threadId || !message || queuedFollowUps.current.has(threadId)) return;
    if (runBlocker) {
      setError(runBlocker);
      return;
    }

    queuedFollowUps.current.set(
      threadId,
      prepareRunRequest(threadId, message, pendingAttachments, explicitlyActiveTools),
    );
    setTask("");
    setPendingAttachments([]);
    setExplicitlyActiveTools([]);
    threadAttachments.current.delete(threadId);
    refreshQueuedFollowUps((value) => value + 1);
    setError(null);
  }

  function cancelQueuedFollowUp(): void {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    const queued = queuedFollowUps.current.get(threadId);
    if (!queued) return;

    queuedFollowUps.current.delete(threadId);
    setTask(queued.request.task);
    setPendingAttachments(queued.attachments);
    setExplicitlyActiveTools(queued.request.explicitlyActiveTools ?? []);
    threadAttachments.current.set(threadId, queued.attachments);
    refreshQueuedFollowUps((value) => value + 1);
    window.requestAnimationFrame(() => taskInput.current?.focus());
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

  async function regenerateResponse(assistantSequence: number): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    const user = [...timeline].reverse().find(
      (item) => item.kind === "user" && item.sequence !== undefined && item.sequence < assistantSequence,
    );
    if (!user || user.kind !== "user" || user.sequence === undefined) {
      setError("The original request is no longer available");
      return;
    }
    const attachments = (user.attachments ?? []).map((attachment) => ({
      ...attachment,
      fingerprint: attachment.id,
    }));

    try {
      const state = await window.desktop.restoreThread(threadId, user.sequence);
      threadTimelines.current.delete(threadId);
      showDesktopState(state);
      await submitTask(threadId, user.text, attachments, []);
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

  async function attachTerminalOutput(output: string): Promise<void> {
    const workspace = desktopState.workspace;
    if (!workspace) return;
    if (pendingAttachments.length >= 8) {
      setError("Attach at most 8 files to one message");
      return;
    }
    try {
      await addAttachments([await window.desktop.importTerminalOutput(workspace.id, output)]);
      window.requestAnimationFrame(() => taskInput.current?.focus());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function attachCodeSelection(input: CodeSelectionInput): Promise<void> {
    if (pendingAttachments.length >= 8) throw new Error("Attach at most 8 files to one message");
    await addAttachments([await window.desktop.importCodeSelection(input)]);
    window.setTimeout(() => taskInput.current?.focus(), 0);
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

  async function setRestrictedEngine(engine: RestrictedEngine): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.setRestrictedEngine(engine)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function addSandboxAccess(input: SandboxAccessInput): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.addSandboxAccess(threadId, input)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function removeSandboxAccess(grantId: string): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.removeSandboxAccess(threadId, grantId)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setThreadSubagentMode(mode: ThreadSubagentMode): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.setThreadSubagentMode(threadId, mode)));
      setContextRefresh((value) => value + 1);
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

  async function grantCommandSandboxAccess(
    id: string,
    inputs: SandboxAccessInput[],
  ): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.grantCommandSandboxAccess(id, inputs)));
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }

  function showDesktopState(state: DesktopState): void {
    followTimeline.current = true;
    const threadChanged = activeThreadId.current !== state.activeThreadId;
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
    setSelectedReasoningEffort(selection.reasoningEffort);
    setSelectedItemId(null);
    setTask(activeDraft(state));
    setPendingAttachments(
      state.activeThreadId ? threadAttachments.current.get(state.activeThreadId) ?? [] : [],
    );
    if (threadChanged) setExplicitlyActiveTools([]);
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

  function isKeptAside(item: TimelineItem): boolean {
    if (item.kind !== "assistant") return false;
    return Boolean(item.entryId && desktopState.keptAside.some((message) => message.entryId === item.entryId));
  }

  async function updateKeptAside(entryId: string, keep: boolean): Promise<void> {
    const threadId = desktopState.activeThreadId;
    if (!threadId) return;
    try {
      const keptAside = keep
        ? await window.desktop.keepAside(threadId, entryId)
        : await window.desktop.removeAside(threadId, entryId);
      setDesktopState((state) => ({ ...state, keptAside }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function toggleKeptAside(item: Extract<TimelineItem, { kind: "assistant" }>): void {
    if (!item.entryId) return;
    void updateKeptAside(item.entryId, !isKeptAside(item));
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
          ?.scrollIntoView({ block: "center", behavior: motionAllowed() ? "smooth" : "auto" });
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

  async function setAnimationsEnabled(animationsEnabled: boolean): Promise<void> {
    try {
      await window.desktop.setAnimationsEnabled(animationsEnabled);
      applyAnimationsEnabled(animationsEnabled);
      setDesktopState((state) => ({ ...state, animationsEnabled }));
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

  async function setAutoTitleGeneration(autoTitleGeneration: boolean): Promise<void> {
    try {
      await window.desktop.setAutoTitleGeneration(autoTitleGeneration);
      setDesktopState((state) => ({ ...state, autoTitleGeneration }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setSandboxNetworkEnabled(sandboxNetworkEnabled: boolean): Promise<void> {
    try {
      await window.desktop.setSandboxNetworkEnabled(sandboxNetworkEnabled);
      setDesktopState((state) => ({ ...state, sandboxNetworkEnabled }));
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
    const nextCatalog = models.find((catalog) => catalog.connection.id === providerConnectionId);
    const nextProfile = nextCatalog ? providerProfile(nextCatalog.connection.providerId) : undefined;
    const sameModel = providerConnectionId === selectedProviderConnectionId &&
      selectedModelBase === splitModelVariant(model, nextProfile?.modelVariants).baseModelId;
    const reasoningEffort = sameModel ? effectiveReasoningEffort : "";
    setSelectedModel(model);
    setSelectedProviderConnectionId(providerConnectionId);
    setSelectedReasoningEffort(reasoningEffort);
    const threadId = desktopState.activeThreadId;
    setDesktopState((state) => setStateModel(
      state,
      threadId,
      providerConnectionId,
      model,
      reasoningEffort,
    ));
    void window.desktop.setSelectedModel(
      threadId,
      providerConnectionId,
      model,
      reasoningEffort || undefined,
    )
      .catch((cause) => setError(errorMessage(cause)));
  }

  function selectReasoningEffort(reasoningEffort: ReasoningEffort | ""): void {
    setSelectedReasoningEffort(reasoningEffort);
    const threadId = desktopState.activeThreadId;
    setDesktopState((state) => setStateModel(
      state,
      threadId,
      selectedProviderConnectionId,
      selectedModel,
      reasoningEffort,
    ));
    void window.desktop.setSelectedModel(
      threadId,
      selectedProviderConnectionId,
      selectedModel,
      reasoningEffort || undefined,
    ).catch((cause) => setError(errorMessage(cause)));
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

  async function connectOnboardingProvider(
    input: ProviderConnectionInput,
  ): Promise<{ connectionId: string; status: ProviderStatus; connected: boolean }> {
    setError(null);
    const existingIds = new Set(desktopState.providerConnections.map((connection) => connection.id));
    const state = await window.desktop.saveProviderConnection(input);
    const connection = input.id
      ? state.providerConnections.find((item) => item.id === input.id)
      : state.providerConnections.find((item) => !existingIds.has(item.id));
    if (!connection) throw new Error("The provider connection could not be saved");

    const catalogs = await window.desktop.listProviderModels();
    const catalog = catalogs.find((item) => item.connection.id === connection.id);
    const currentBaseModel = splitModelVariant(
      state.defaultModel ?? "",
      providerProfile(connection.providerId).modelVariants,
    ).baseModelId;
    const currentModelIsAvailable = state.defaultProviderConnectionId === connection.id &&
      catalog?.models.some((model) => model.id === state.defaultModel || model.id === currentBaseModel);
    const defaultModel = currentModelIsAvailable
      ? state.defaultModel
      : catalog?.models.find((model) => !model.toolUseUnavailableReason)?.id ?? null;
    if (defaultModel && !currentModelIsAvailable) {
      await window.desktop.setSelectedModel(null, connection.id, defaultModel);
    }

    setDesktopState(withoutConversation({
      ...state,
      ...(defaultModel
        ? { defaultProviderConnectionId: connection.id, defaultModel }
        : {}),
    }));
    setModels(catalogs);
    try {
      const status = await window.desktop.getProviderStatus({ ...input, id: connection.id });
      return { connectionId: connection.id, status, connected: true };
    } catch (cause) {
      return {
        connectionId: connection.id,
        status: { message: errorMessage(cause) },
        connected: false,
      };
    }
  }

  async function setOnboardingManualModel(
    connection: DesktopState["providerConnections"][number],
    model: string,
  ): Promise<void> {
    const manualModel = {
      id: model,
      name: model,
      contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
      inputModalities: ["text"],
    };
    const state = await window.desktop.saveProviderConnection({
      ...connection,
      manualModels: [
        ...connection.manualModels.filter((item) => item.id !== model),
        manualModel,
      ],
    });
    await window.desktop.setSelectedModel(null, connection.id, model);
    setModels(await window.desktop.listProviderModels());
    setDesktopState(withoutConversation({
      ...state,
      defaultProviderConnectionId: connection.id,
      defaultModel: model,
    }));
  }

  async function completeOnboarding(): Promise<void> {
    await window.desktop.completeOnboarding();
    setDesktopState((state) => ({ ...state, onboardingComplete: true }));
    setOnboardingOpen(false);
  }

  async function removeProviderConnection(id: string): Promise<void> {
    setError(null);
    try {
      const state = await window.desktop.removeProviderConnection(id);
      setDesktopState(withoutConversation(state));
      const selection = activeModel(state);
      setSelectedModel(selection.model);
      setSelectedProviderConnectionId(selection.providerConnectionId);
      setSelectedReasoningEffort(selection.reasoningEffort);
      await loadModels();
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }

  async function saveMcpServer(server: McpServerConfig): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.saveMcpServer(server)));
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }

  async function setMcpEnabled(enabled: boolean): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.setMcpEnabled(enabled)));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function removeMcpServer(id: string): Promise<void> {
    setError(null);
    try {
      setDesktopState(withoutConversation(await window.desktop.removeMcpServer(id)));
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

  async function resetAppearance(): Promise<void> {
    try {
      await Promise.all([
        window.desktop.setTheme(DEFAULT_THEME.id),
        window.desktop.setAnimationsEnabled(true),
        window.desktop.setTypography(DEFAULT_FONTS.interface, DEFAULT_FONTS.primary, DEFAULT_FONTS.secondary, DEFAULT_FONTS.code),
        window.desktop.setTypographyScale("interface", DEFAULT_FONT_SCALE),
        window.desktop.setTypographyScale("conversation", DEFAULT_FONT_SCALE),
        window.desktop.setCodeBlockFontSize(DEFAULT_CODE_BLOCK_FONT_SIZE),
        window.desktop.setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE),
      ]);
      applyTheme(DEFAULT_THEME);
      applyAnimationsEnabled(true);
      applyTypography(DEFAULT_FONTS.interface, DEFAULT_FONTS.primary, DEFAULT_FONTS.secondary, DEFAULT_FONTS.code);
      applyTypographyScale("interface", DEFAULT_FONT_SCALE);
      applyTypographyScale("conversation", DEFAULT_FONT_SCALE);
      setDesktopState((state) => ({
        ...state,
        themeId: DEFAULT_THEME.id,
        animationsEnabled: true,
        interfaceFont: DEFAULT_FONTS.interface,
        primaryFont: DEFAULT_FONTS.primary,
        secondaryFont: DEFAULT_FONTS.secondary,
        codeFont: DEFAULT_FONTS.code,
        interfaceFontScale: DEFAULT_FONT_SCALE,
        conversationFontScale: DEFAULT_FONT_SCALE,
        codeBlockFontSize: DEFAULT_CODE_BLOCK_FONT_SIZE,
        editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
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

  async function setWalkthroughModel(walkthroughModel: WalkthroughModelSetting): Promise<void> {
    try {
      await window.desktop.setWalkthroughModel(walkthroughModel);
      setDesktopState((state) => ({ ...state, walkthroughModel }));
      setError(null);
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

  async function setImageUnderstanding(imageUnderstanding: ImageUnderstandingProfile): Promise<void> {
    try {
      await window.desktop.setImageUnderstanding(imageUnderstanding);
      setDesktopState((state) => ({ ...state, imageUnderstanding }));
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

  async function setSystemPrompt(systemPrompt: string): Promise<void> {
    try {
      const state = await window.desktop.setSystemPrompt(systemPrompt);
      setDesktopState((current) => ({ ...current, systemPrompt: state.systemPrompt }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setToolEnabled(name: string, enabled: boolean): Promise<void> {
    try {
      const state = await window.desktop.setToolEnabled(name, enabled);
      setDesktopState((current) => ({
        ...current,
        modelTools: state.modelTools,
        toolSpecs: state.toolSpecs,
        disabledTools: state.disabledTools,
      }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function setModelToolSurface(surface: ModelToolSurface): Promise<void> {
    if (!selectedModel) return;
    try {
      const state = await window.desktop.setModelToolSurface(
        selectedProviderConnectionId,
        selectedModel,
        surface,
      );
      setDesktopState((current) => ({
        ...current,
        modelToolSurfaces: state.modelToolSurfaces,
        toolSpecs: state.toolSpecs,
      }));
      setContextRefresh((value) => value + 1);
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

  async function setSpeechSettings(speech: SpeechSettings): Promise<void> {
    try {
      const state = await window.desktop.setSpeechSettings(speech);
      setDesktopState((current) => ({ ...current, speech: state.speech }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function installSpeechModel(model: SpeechModel): Promise<void> {
    try {
      const speechModels = await window.desktop.installSpeechModel(model);
      setDesktopState((current) => ({ ...current, speechModels }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function removeSpeechModel(model: SpeechModel): Promise<void> {
    try {
      const speechModels = await window.desktop.removeSpeechModel(model);
      setDesktopState((current) => ({ ...current, speechModels }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function prepareSpeechRecognition(): void {
    const input = taskInput.current;
    const draft = input?.value ?? task;
    const start = Math.min(input?.selectionStart ?? draft.length, draft.length);
    const end = input?.selectionEnd ?? start;
    speechDraft.current = {
      prefix: draft.slice(0, start),
      suffix: draft.slice(end),
    };
  }

  async function startSpeechRecognition(): Promise<void> {
    try {
      setError(null);
      await window.desktop.startSpeechRecognition(
        desktopState.speech.localModel,
        desktopState.speech.language,
      );
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }

  async function stopSpeechRecognition(): Promise<void> {
    try {
      await window.desktop.stopSpeechRecognition();
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
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

  const subagentReady = Boolean(
    desktopState.subagent.providerConnectionId &&
    desktopState.subagent.model &&
    desktopState.subagent.maxSteps > 0,
  );
  const subagentsEnabledForThread = subagentReady && Boolean(activeThread) && (
    activeThread?.subagentMode === "enabled" ||
    (activeThread?.subagentMode === "inherit" && desktopState.subagent.enabled)
  );
  const commands: AppCommand[] = [
    {
      id: "thread-new",
      label: "New chat thread",
      detail: desktopState.workspace ? `Create in ${desktopState.workspace.name}` : "Open a workspace first",
      keywords: "chat conversation",
      shortcut: "",
      scope: "chat",
      disabled: !desktopState.workspace,
      run: () => {
        const workspace = desktopState.workspace;
        if (!workspace) return;
        void saveDraft()
          .then(() => window.desktop.createThread(workspace.id))
          .then(showDesktopState)
          .catch((cause: unknown) => setError(errorMessage(cause)));
      },
    },
    {
      id: "search",
      label: "Search conversations",
      detail: "Search messages across workspaces",
      keywords: "find history",
      shortcut: window.desktop.platform === "darwin" ? "⌘K" : "Ctrl+K",
      scope: "chat",
      run: () => showView("search"),
    },
    {
      id: "context-compact",
      label: "Compact context now",
      detail: "Create a context checkpoint for this thread",
      keywords: "summarize tokens",
      scope: "chat",
      disabled: !activeThread || !selectedModel || running || compactingContext,
      run: () => void compactCurrentContext(),
    },
    {
      id: "subagents-enable",
      label: "Enable subagents for this thread",
      detail: subagentReady ? "Expose delegate_task in this thread" : "Configure a subagent model in Settings first",
      keywords: "agent delegate on enable",
      scope: "chat",
      active: subagentsEnabledForThread,
      disabled: !activeThread || running || !subagentReady,
      run: () => void setThreadSubagentMode("enabled"),
    },
    {
      id: "subagents-disable",
      label: "Disable subagents for this thread",
      detail: "Hides delegate_task from this thread",
      keywords: "agent delegate off disable",
      scope: "chat",
      active: Boolean(activeThread) && !subagentsEnabledForThread,
      disabled: !activeThread || running,
      run: () => void setThreadSubagentMode("disabled"),
    },
    {
      id: "settings-agent",
      label: "Open agent settings",
      detail: "Configure subagent models and limits",
      keywords: "preferences configuration",
      run: () => {
        setSettingsPage("agent");
        setView("settings");
      },
    },
    {
      id: "sidebar-toggle",
      label: leftCollapsed ? "Show workspace sidebar" : "Hide workspace sidebar",
      keywords: "left panel",
      run: () => {
        leftAutoCollapsed.current = false;
        setLeftCollapsed((value) => !value);
      },
    },
    {
      id: "inspector-toggle",
      label: rightCollapsed ? "Show inspector" : "Hide inspector",
      keywords: "right panel inspect",
      disabled: view !== "conversation",
      run: () => rightCollapsed ? setRightCollapsed(false) : hideRightPanel(),
    },
    {
      id: "terminal-toggle",
      label: terminalOpen ? "Hide terminal" : "Show terminal",
      detail: desktopState.workspace ? `Open in ${desktopState.workspace.name}` : "Open a workspace first",
      keywords: "shell console command line",
      shortcut: window.desktop.platform === "darwin" ? "⌃`" : "Ctrl+`",
      disabled: !desktopState.workspace,
      run: toggleTerminal,
    },
    ...desktopState.skills.map((skill): AppCommand => ({
      id: `skill:${skill.name}`,
      label: `/${skill.name}`,
      detail: skill.compatibility === "compatible"
        ? skill.description
        : `${skill.description} · ${skill.compatibility === "incompatible" ? "Unavailable" : "Compatibility unknown"}: ${skill.compatibilityNote ?? "Verify required capabilities before use."}`,
      keywords: `skill workflow ${skill.source}`,
      scope: "chat",
      searchOnly: skill.origin === "codex" || skill.origin === "claude",
      disabled: !activeThread || running || skill.compatibility === "incompatible",
      run: () => {
        const warning = skill.compatibility === "unknown"
          ? ` Its compatibility is unknown: ${skill.compatibilityNote} Stop and explain the limitation if a required capability is unavailable.`
          : "";
        const activation = `Use the "${skill.name}" skill for this task. Load its instructions with use_skill before proceeding.${warning}`;
        setTask((current) => current.trim()
          ? `${activation}\n\n${current}`
          : `${activation}\n\n`);
        setExplicitlyActiveTools((current) => [...new Set([...current, "use_skill"])]);
        window.requestAnimationFrame(() => taskInput.current?.focus());
      },
    })),
  ];

  function closeCommands(): void {
    const refocus = commandMode === "slash";
    setCommandMode(null);
    if (refocus) window.requestAnimationFrame(() => taskInput.current?.focus());
  }

  if (!stateLoaded) return <main className="app-shell" />;

  if (onboardingOpen) {
    return (
      <Onboarding
        dismissible={desktopState.onboardingComplete}
        themeId={desktopState.themeId}
        connections={desktopState.providerConnections}
        catalogs={models}
        loadingModels={loadingModels}
        defaultConnectionId={desktopState.defaultProviderConnectionId}
        defaultModel={desktopState.defaultModel}
        webEnabled={desktopState.webSearchEnabled}
        webBackend={desktopState.webSearchBackend}
        webKeyBackends={desktopState.webSearchKeyBackends}
        subagent={desktopState.subagent}
        onConnect={connectOnboardingProvider}
        onManualModel={setOnboardingManualModel}
        onTheme={(themeId) => void selectTheme(themeId)}
        onWebEnabled={(enabled) => void setWebSearchEnabled(enabled)}
        onWebBackend={(backend) => void setWebSearchBackend(backend)}
        onWebKey={async (backend, apiKey) => setWebSearchApiKey(backend, apiKey)}
        onSubagent={(profile) => void setSubagent(profile)}
        onComplete={completeOnboarding}
        onDismiss={() => setOnboardingOpen(false)}
      />
    );
  }

  return (
    <main className={`app-shell platform-${window.desktop.platform}`}>
      <section
        className={`workspace-shell${terminalVisible ? " terminal-open" : ""}${rightPanelFocused.current ? " right-panel-focused" : ""}`}
        style={{
          gridTemplateColumns: rightPanelFocused.current
            ? `0px minmax(360px, 1fr) ${rightWidth}px`
            : `${visibleLeftWidth}px minmax(360px, 1fr) ${visibleRightWidth}px`,
          gridTemplateRows: terminalVisible
            ? "minmax(0, 1fr) var(--terminal-height)"
            : "minmax(0, 1fr) 0px",
        }}
      >
        <Sidebar
          state={desktopState}
          runningThreadIds={desktopState.runningThreadIds}
          updateState={updateState}
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
          terminalOpen={terminalOpen}
          onTerminal={toggleTerminal}
          onCollapse={() => {
            leftAutoCollapsed.current = false;
            setLeftCollapsed(true);
          }}
        />

        {view === "settings" ? (
          <Settings
            page={settingsPage}
            themeId={desktopState.themeId}
            animationsEnabled={desktopState.animationsEnabled}
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
            walkthroughModel={desktopState.walkthroughModel}
            maxSteps={desktopState.maxSteps}
            autoTitleGeneration={desktopState.autoTitleGeneration}
            providerTimeoutMinutes={desktopState.providerTimeoutMinutes}
            providerRetries={desktopState.providerRetries}
            subagent={desktopState.subagent}
            imageUnderstanding={desktopState.imageUnderstanding}
            compactionMode={desktopState.compactionMode}
            compactionThreshold={desktopState.compactionThreshold}
            ketchAvailable={desktopState.ketchAvailable}
            openRouterAvailable={desktopState.openRouterAvailable}
            deepSeekAvailable={desktopState.deepSeekAvailable}
            webSearchEnabled={desktopState.webSearchEnabled}
            webSearchBackend={desktopState.webSearchBackend}
            webSearchKeyBackends={desktopState.webSearchKeyBackends}
            speech={desktopState.speech}
            speechModels={desktopState.speechModels}
            providerConnections={desktopState.providerConnections}
            mcpEnabled={desktopState.mcpEnabled}
            mcpServers={desktopState.mcpServers}
            modelTools={desktopState.modelTools}
            systemPrompt={desktopState.systemPrompt}
            runtimeMetadata={desktopState.runtimeMetadata}
            providerCatalogs={models}
            loadingProviderModels={loadingModels}
            updateState={updateState}
            activeRun={desktopState.runningThreadIds.length > 0}
            error={error}
            onResetAppearance={() => void resetAppearance()}
            onSelectTheme={(themeId) => void selectTheme(themeId)}
            onAnimationsEnabled={(enabled) => void setAnimationsEnabled(enabled)}
            onTypography={(interfaceFont, primary, secondary, code) => void setTypography(interfaceFont, primary, secondary, code)}
            onTypographyScale={(role, value) => void setTypographyScale(role, value)}
            onCodeBlockFontSize={(size) => void setCodeBlockFontSize(size)}
            onEditorFontSize={(size) => void setEditorFontSize(size)}
            onEditorLauncher={(command, argumentsTemplate) => void setEditorLauncher(command, argumentsTemplate)}
            onChooseEditor={() => void chooseEditorApplication()}
            onWalkthroughModel={(setting) => void setWalkthroughModel(setting)}
            onMaxSteps={(maxSteps) => void setMaxSteps(maxSteps)}
            onAutoTitleGeneration={(enabled) => void setAutoTitleGeneration(enabled)}
            onProviderTimeoutMinutes={(minutes) => void setProviderTimeoutMinutes(minutes)}
            onProviderRetries={(retries) => void setProviderRetries(retries)}
            onSubagent={(profile) => void setSubagent(profile)}
            onImageUnderstanding={(profile) => void setImageUnderstanding(profile)}
            onCompaction={(mode, threshold) => void setCompaction(mode, threshold)}
            onWebSearchEnabled={(enabled) => void setWebSearchEnabled(enabled)}
            onWebSearchBackend={(backend) => void setWebSearchBackend(backend)}
            onWebSearchApiKey={(backend, apiKey) => void setWebSearchApiKey(backend, apiKey)}
            onSpeechSettings={(speech) => void setSpeechSettings(speech)}
            onInstallSpeechModel={(model) => void installSpeechModel(model)}
            onRemoveSpeechModel={(model) => void removeSpeechModel(model)}
            onSaveProvider={saveProviderConnection}
            onRemoveProvider={removeProviderConnection}
            onTestProvider={(input) => window.desktop.getProviderStatus(input)}
            onMcpEnabled={(enabled) => void setMcpEnabled(enabled)}
            onSaveMcpServer={saveMcpServer}
            onRemoveMcpServer={removeMcpServer}
            onTestMcpServer={(server): Promise<McpServerStatus> => window.desktop.testMcpServer(server)}
            onSystemPrompt={(prompt) => void setSystemPrompt(prompt)}
            onToolEnabled={(name, enabled) => void setToolEnabled(name, enabled)}
            onOpenOnboarding={() => setOnboardingOpen(true)}
            onCheckForUpdates={() => void checkForUpdates()}
            onApplyUpdate={() => void applyUpdate()}
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
          <section
            className="conversation view-enter"
            aria-label="Conversation"
          >
          <div className="timeline-shell">
            <div
              ref={timelineView}
              className="timeline"
              aria-live="polite"
              onScroll={(event) => {
                const view = event.currentTarget;
                const scrolledUp = view.scrollTop < timelineScrollTop.current - 1;
                timelineScrollTop.current = view.scrollTop;
                const distanceFromBottom = view.scrollHeight - view.scrollTop - view.clientHeight;
                const following = !scrolledUp && distanceFromBottom < 80;
                followTimeline.current = following;
                setShowJumpToLatest(distanceFromBottom > view.clientHeight * 0.4);
              }}
            >
              <div ref={timelineContent}>
                {timeline.map((item) => (
                  <TimelineEntry
                    key={item.id}
                    item={item}
                    previousModel={previousAssistantModels.get(item.id)}
                    selectedId={selectedItemId}
                    turnRunning={running && currentTurnItemIds.has(item.id)}
                    activeToolPreviewId={activeToolPreviewId}
                    fileChangeSummary={answerFileChanges.get(item.id)}
                    reasoningModelCalls={reasoningModelCalls}
                    onSelect={(id) => {
                      setSelectedItemId((current) => current === id ? null : id);
                      selectInspectorTab("inspect");
                      setRightCollapsed(false);
                    }}
                    {...(gitRepositoryReady ? { onOpenFile: openBuiltInFileEditor } : {})}
                    onReviewChanges={() => reviewAgentChanges(item.id)}
                    onResolveApproval={(id, decision) => void resolveCommandApproval(id, decision)}
                    onChooseSandboxFolder={() => window.desktop.chooseSandboxFolder()}
                    onGrantSandboxAccess={grantCommandSandboxAccess}
                    savedId={
                      item.kind === "assistant"
                        ? savedIdFor(item)
                        : undefined
                    }
                    onToggleSaved={(message, savedId) => void toggleSavedMessage(message, savedId)}
                    keptAside={isKeptAside(item)}
                    canKeepAside={desktopState.keptAside.length < MAX_KEPT_ASIDE_MESSAGES}
                    onToggleKeptAside={toggleKeptAside}
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
                    {...(!running ? { onRegenerate: (sequence) => void regenerateResponse(sequence) } : {})}
                    {...(!running ? { onFork: (sequence) => void forkThread(sequence) } : {})}
                  />
                ))}
                {running ? <ActivePlan items={timeline} /> : null}
              </div>
            </div>
            <AsideShelf
              messages={desktopState.keptAside}
              onOpen={(entryId) => scrollToEntry(entryId, "Kept aside message no longer exists")}
              onRemove={(entryId) => void updateKeptAside(entryId, false)}
            />
            {showJumpToLatest ? (
              <button
                type="button"
                className="jump-to-latest"
                aria-label="Scroll to latest message"
                title="Scroll to latest"
                onClick={() => {
                  const view = timelineView.current;
                  if (!view) return;
                  followTimeline.current = true;
                  setShowJumpToLatest(false);
                  view.scrollTop = view.scrollHeight;
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4.5 7.5 10 13l5.5-5.5" />
                </svg>
                Latest
              </button>
            ) : null}
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
            preparing={preparing}
            providerWait={desktopState.activeThreadId ? providerWaits[desktopState.activeThreadId] ?? null : null}
            pendingAttachmentCount={pendingAttachments.length}
            models={models}
            selectedProviderConnectionId={selectedProviderConnectionId}
            selectedModel={selectedModel}
            reasoningEffort={effectiveReasoningEffort}
            providerAllowance={providerAllowances[selectedProviderConnectionId]}
            toolSurface={toolSurface}
            activeToolNames={activeToolNames}
            availableToolNames={availableToolNames}
            loadingModels={loadingModels}
            providerAvailable={desktopState.providerConnections.some((connection) => connection.enabled)}
            contextReport={contextReport}
            pendingContextTokens={pendingContextTokens}
            compactingContext={compactingContext}
            unsafe={unsafeHostExecution}
            restrictedEngine={desktopState.restrictedEngine}
            restrictedAvailable={desktopState.restrictedHostAvailable}
            restrictedDetail={desktopState.restrictedHostDetail}
            microsandboxAvailable={desktopState.microsandboxAvailable}
            microsandboxDetail={desktopState.microsandboxDetail}
            sandboxAccess={desktopState.sandboxAccess}
            sandboxNetworkEnabled={desktopState.sandboxNetworkEnabled}
            orbMotion={sendOrbMotion}
            blocker={runBlocker}
            error={error}
            platform={window.desktop.platform}
            queuedMessage={queuedFollowUp?.request.task ?? null}
            voiceEnabled={desktopState.speech.enabled}
            voiceAutoStopOnSilence={desktopState.speech.autoStopOnSilence}
            voiceReady={desktopState.speechModels.some(
              (model) => model.id === desktopState.speech.localModel && model.phase === "ready",
            )}
            onTask={setTask}
            onSubmit={(event) => void startRun(event)}
            onDragging={setDraggingAttachments}
            onDrop={(event) => void dropAttachments(event)}
            onPaste={(event) => void pasteIntoTask(event)}
            onPastePlain={() => void pastePlainText()}
            onPasteMarkdown={() => void pasteMarkdown()}
            onChooseAttachments={() => void chooseAttachments()}
            onModel={selectModel}
            onReasoningEffort={selectReasoningEffort}
            onProviderAllowance={() => void refreshProviderAllowance(selectedProviderConnectionId)}
            onToolSurface={(surface) => void setModelToolSurface(surface)}
            onCompact={() => void compactCurrentContext()}
            onUnsafe={(value) => void setThreadUnsafe(value)}
            onRestrictedEngine={(engine) => void setRestrictedEngine(engine)}
            onChooseSandboxLocation={() => window.desktop.chooseSandboxFolder()}
            onAddSandboxAccess={(input) => void addSandboxAccess(input)}
            onRemoveSandboxAccess={(grantId) => void removeSandboxAccess(grantId)}
            onSandboxNetworkEnabled={(enabled) => void setSandboxNetworkEnabled(enabled)}
            onStop={() => void stopRun()}
            onQueue={queueFollowUp}
            onCancelQueued={cancelQueuedFollowUp}
            onSlashCommand={() => setCommandMode("slash")}
            onVoicePrepare={prepareSpeechRecognition}
            onVoiceStart={startSpeechRecognition}
            onVoiceAudio={(samples, sampleRate) => window.desktop.sendSpeechAudio(samples, sampleRate)}
            onVoiceStop={stopSpeechRecognition}
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
              selectedReasoningEffort={effectiveReasoningEffort || undefined}
              selectedProviderConnectionId={selectedProviderConnectionId}
              walkthroughModel={desktopState.walkthroughModel.model || selectedModel}
              walkthroughProviderConnectionId={desktopState.walkthroughModel.providerConnectionId || selectedProviderConnectionId}
              walkthroughReasoningEffort={desktopState.walkthroughModel.model
                ? undefined
                : effectiveReasoningEffort || undefined}
              gitWalkthrough={gitWalkthrough?.open && gitWalkthrough.workspaceId === desktopState.workspace?.id
                ? gitWalkthrough.result
                : null}
              latestGitWalkthrough={gitWalkthrough && gitWalkthrough.workspaceId === desktopState.workspace?.id
                ? gitWalkthrough.result
                : null}
              providerNames={Object.fromEntries(desktopState.providerConnections.map((connection) => [connection.id, connection.name]))}
              modelInstructions={desktopState.modelInstructions}
              toolSpecs={desktopState.toolSpecs}
              tab={inspectorTab}
              fileEditorRequest={fileEditorRequest}
              changesTurnRequest={changesTurnRequest}
              focused={rightPanelFocused.current}
              onTab={selectInspectorTab}
              onEnterFocus={() => setRightPanelFocus(true)}
              onExitFocus={() => setRightPanelFocus(false)}
              onSelect={setSelectedItemId}
              onNavigateTurn={scrollToTimelineItem}
              onGitDetailOpen={handleGitDetailOpen}
              onGitRepositoryState={setGitRepositoryReady}
              onAskSelection={attachCodeSelection}
              onGitWalkthrough={(result) => {
                const workspaceId = desktopState.workspace?.id;
                if (workspaceId) setGitWalkthrough({ workspaceId, result, open: true });
              }}
              onOpenGitWalkthrough={() => setGitWalkthrough((current) => current
                ? { ...current, open: true }
                : null)}
              onCloseGitWalkthrough={() => setGitWalkthrough((current) => current
                ? { ...current, open: false }
                : null)}
              onCollapse={hideRightPanel}
            />
          ) : null}
        </aside>

        {terminalMounted && desktopState.workspace ? (
          <TerminalPanel
            workspaceId={desktopState.workspace.id}
            workspaceName={desktopState.workspace.name}
            themeId={desktopState.themeId}
            onAttachOutput={(output) => void attachTerminalOutput(output)}
            onClose={hideTerminal}
            onError={setError}
          />
        ) : null}

        {rightPanelFocused.current ? null : leftCollapsed ? (
          <button
            className="panel-reopen left"
            type="button"
            onClick={() => {
              setRightPanelFocus(false);
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
        ) : rightPanelFocused.current ? null : (
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
      {commandMode ? (
        <CommandPalette mode={commandMode} commands={commands} onClose={closeCommands} />
      ) : null}
    </main>
  );
}

function focusedEditorWidth(): number {
  return Math.max(0, Math.min(Math.round(window.innerWidth * 0.65), window.innerWidth - 360));
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

function applyAnimationsEnabled(enabled: boolean): void {
  document.documentElement.dataset.animations = enabled ? "on" : "off";
  window.dispatchEvent(new Event("animations-setting-change"));
}

function motionAllowed(): boolean {
  return document.documentElement.dataset.animations !== "off"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function activeModel(state: DesktopState): {
  providerConnectionId: string;
  model: string;
  reasoningEffort: ReasoningEffort | "";
} {
  const thread = state.workspace?.threads.find((thread) => thread.id === state.activeThreadId);
  return {
    providerConnectionId: thread?.model
      ? thread.providerConnectionId
      : state.defaultProviderConnectionId,
    model: thread?.model ?? state.defaultModel ?? "",
    reasoningEffort: thread?.reasoningEffort ?? "",
  };
}

function setStateModel(
  state: DesktopState,
  threadId: string | null,
  providerConnectionId: string,
  model: string,
  reasoningEffort: ReasoningEffort | "" = "",
): DesktopState {
  const updateWorkspace = (workspace: DesktopState["workspace"]): DesktopState["workspace"] => workspace
    ? {
        ...workspace,
        threads: workspace.threads.map((thread) => thread.id === threadId
          ? { ...thread, providerConnectionId, model, reasoningEffort }
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

function withoutKey(values: Record<string, string>, key: string): Record<string, string> {
  if (!(key in values)) return values;
  const next = { ...values };
  delete next[key];
  return next;
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

function uniqueCatalogModelMatch(catalog: ProviderCatalog, unavailableModel: string): string | null {
  const unavailableKey = modelLeafKey(unavailableModel);
  if (!unavailableKey) return null;
  const matches = catalog.models.filter((model) => modelLeafKey(model.id) === unavailableKey);
  return matches.length === 1 ? matches[0]!.id : null;
}

function modelLeafKey(model: string): string {
  return (model.split("/").at(-1) ?? model).toLowerCase().replace(/[^a-z0-9]/g, "");
}
