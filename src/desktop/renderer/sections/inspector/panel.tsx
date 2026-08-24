import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CodeSelectionInput,
  DesktopWorkspace,
  GitWalkthroughResult,
  GitWalkthroughRunInput,
} from "../../../api.js";
import type { TimelineItem } from "../conversation/timeline-state.js";
import { ExecutionOverview } from "./overview.js";
import { Inspector } from "./inspect.js";
import { GitPanel } from "./git/panel.js";
import type { ToolSpec } from "../../../../protocol.js";

export type InspectorTab = "inspect" | "changes" | "git";
export type FileEditorRequest = { workspaceId: string; path: string; requestId: number };
export type ChangesTurnRequest = { turnId: string; requestId: number };

const ChangesPanel = lazy(() => import("./changes/panel.js"));
const TAB_POSITION: Record<InspectorTab, number> = { inspect: 0, changes: 1, git: 2 };

export function InspectorPanel({
  workspace,
  selectedItem,
  timeline,
  running,
  selectedModel,
  selectedReasoningEffort,
  selectedProviderConnectionId,
  walkthroughModel,
  walkthroughProviderConnectionId,
  walkthroughReasoningEffort,
  gitWalkthrough,
  latestGitWalkthrough,
  providerNames,
  modelInstructions,
  toolSpecs,
  tab,
  fileEditorRequest,
  changesTurnRequest,
  focused,
  onTab,
  onEnterFocus,
  onExitFocus,
  onSelect,
  onNavigateTurn,
  onGitDetailOpen,
  onGitRepositoryState,
  onAskSelection,
  onGitWalkthrough,
  onOpenGitWalkthrough,
  onCloseGitWalkthrough,
  onCollapse,
}: {
  workspace: DesktopWorkspace | null;
  selectedItem: TimelineItem | null | undefined;
  timeline: TimelineItem[];
  running: boolean;
  selectedModel: string;
  selectedReasoningEffort: GitWalkthroughRunInput["reasoningEffort"];
  selectedProviderConnectionId: string;
  walkthroughModel: string;
  walkthroughProviderConnectionId: string;
  walkthroughReasoningEffort: GitWalkthroughRunInput["reasoningEffort"];
  gitWalkthrough: GitWalkthroughResult | null;
  latestGitWalkthrough: GitWalkthroughResult | null;
  providerNames: Record<string, string>;
  modelInstructions: string[];
  toolSpecs: ToolSpec[];
  tab: InspectorTab;
  fileEditorRequest: FileEditorRequest | null;
  changesTurnRequest: ChangesTurnRequest | null;
  focused: boolean;
  onTab(tab: InspectorTab): void;
  onEnterFocus(): void;
  onExitFocus(): void;
  onSelect(id: string | null): void;
  onNavigateTurn(id: string): void;
  onGitDetailOpen(open: boolean): void;
  onGitRepositoryState(ready: boolean): void;
  onAskSelection(input: CodeSelectionInput): Promise<void>;
  onGitWalkthrough(result: GitWalkthroughResult): void;
  onOpenGitWalkthrough(): void;
  onCloseGitWalkthrough(): void;
  onCollapse(): void;
}): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const overviewScrollTop = useRef(0);
  const followLiveRun = useRef(true);
  const wasRunning = useRef(false);
  const [changesDetailOpen, setChangesDetailOpen] = useState(false);
  const [tabTransition, setTabTransition] = useState<{
    tab: InspectorTab;
    direction: "none" | "forward" | "back";
  }>({ tab, direction: "none" });
  const tabDirection = tabTransition.tab === tab
    ? tabTransition.direction
    : TAB_POSITION[tab] > TAB_POSITION[tabTransition.tab] ? "forward" : "back";
  const tabEntranceDirection = tab === "inspect" ? "none" : tabDirection;

  useLayoutEffect(() => {
    setTabTransition((current) => current.tab === tab ? current : {
      tab,
      direction: TAB_POSITION[tab] > TAB_POSITION[current.tab] ? "forward" : "back",
    });
  }, [tab]);

  const selectedItemId = selectedItem?.id;
  useLayoutEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollTop = selectedItemId ? 0 : overviewScrollTop.current;
  }, [selectedItemId]);

  useEffect(() => {
    if (!focused || tab !== "changes" || changesDetailOpen) return;
    const exitFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onExitFocus();
    };
    window.addEventListener("keydown", exitFocus);
    return () => window.removeEventListener("keydown", exitFocus);
  }, [changesDetailOpen, focused, onExitFocus, tab]);

  useLayoutEffect(() => {
    if (running && !wasRunning.current) followLiveRun.current = true;
    wasRunning.current = running;
    if (running && !selectedItem && tab === "inspect" && followLiveRun.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [running, selectedItem, tab, timeline]);

  function trackOverviewScroll(): void {
    const content = contentRef.current;
    if (!content || !running || selectedItem || tab !== "inspect") return;
    followLiveRun.current = content.scrollHeight - content.scrollTop - content.clientHeight < 48;
  }

  const selectFromOverview = (id: string): void => {
    overviewScrollTop.current = contentRef.current?.scrollTop ?? 0;
    onSelect(id);
  };

  const hasDetailSections = selectedItem?.kind === "assistant" || (
    selectedItem?.kind === "tool" && !(selectedItem.call.name === "delegate_task" && selectedItem.details)
  );

  function setDetailSections(open: boolean): void {
    contentRef.current?.querySelectorAll<HTMLDetailsElement>(".inspector-section")
      .forEach((section) => { section.open = open; });
  }

  return (
    <>
      <div className="section-heading inspector-heading">
        <div className="inspector-heading-navigation">
          {focused && tab === "changes" && !changesDetailOpen ? (
            <button className="inspector-focus-expand" type="button" onClick={onExitFocus} title="Return to the normal panel (Esc)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.75 3.5-4.5 4.5 4.5 4.5" /></svg>
              <span>Back (Esc)</span>
            </button>
          ) : null}
          <div className="inspector-tabs" role="tablist" aria-label="Right panel">
            <button className={tab === "inspect" ? "active" : ""} type="button" role="tab" aria-selected={tab === "inspect"} onClick={() => onTab("inspect")}>Inspect</button>
            <button className={tab === "changes" ? "active" : ""} type="button" role="tab" aria-selected={tab === "changes"} onClick={() => onTab("changes")}>Changes</button>
            <button className={tab === "git" ? "active" : ""} type="button" role="tab" aria-selected={tab === "git"} onClick={() => onTab("git")}>Git</button>
          </div>
        </div>
        <div className="inspector-heading-actions">
          {tab === "changes" && !focused ? (
            <button className="inspector-focus-expand" type="button" onClick={onEnterFocus} title="Expand changes review">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v3M10 3h3v3M6 13H3v-3M10 13h3v-3" /></svg>
              <span>Expand</span>
            </button>
          ) : null}
          <button className="panel-toggle" type="button" onClick={onCollapse} aria-label="Hide right panel" title="Hide right panel">
            <span className="pane-icon right" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className={`inspector-tab-view${tabEntranceDirection === "none" ? "" : ` enter-${tabEntranceDirection}`}`}
        key={tab}
      >
        {tab === "inspect" ? (
          <div className="inspector-content" ref={contentRef} onScroll={trackOverviewScroll}>
            {selectedItem ? (
              <div className="inspector-view inspector-view-detail">
                <div className="inspector-detail-toolbar">
                  <button className="execution-back" type="button" onClick={() => onSelect(null)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m9.75 3.5-4.5 4.5 4.5 4.5" />
                    </svg>
                    <span>Back</span>
                  </button>
                  {hasDetailSections ? (
                    <div className="inspector-detail-actions">
                      <button type="button" onClick={() => setDetailSections(true)}>Expand all</button>
                      <button type="button" onClick={() => setDetailSections(false)}>Collapse all</button>
                    </div>
                  ) : null}
                </div>
                <Inspector
                  item={selectedItem}
                  timeline={timeline}
                  instructions={modelInstructions}
                  tools={toolSpecs}
                />
              </div>
            ) : (
              <div className="inspector-view inspector-view-overview">
                <ExecutionOverview
                  timeline={timeline}
                  running={running}
                  selectedModel={selectedModel}
                  selectedProviderConnectionId={selectedProviderConnectionId}
                  providerNames={providerNames}
                  onSelect={selectFromOverview}
                  onNavigateTurn={onNavigateTurn}
                />
              </div>
            )}
          </div>
        ) : tab === "changes" ? (
          <Suspense fallback={<p className="inspector-empty">Loading changes…</p>}>
            <ChangesPanel
              timeline={timeline}
              request={changesTurnRequest}
              onBack={onExitFocus}
              onDetailOpen={setChangesDetailOpen}
            />
          </Suspense>
        ) : (
          <GitPanel
            workspace={workspace}
            running={running}
            request={fileEditorRequest}
            walkthrough={gitWalkthrough}
            latestWalkthrough={latestGitWalkthrough}
            walkthroughModel={walkthroughModel}
            walkthroughProviderConnectionId={walkthroughProviderConnectionId}
            walkthroughReasoningEffort={walkthroughReasoningEffort}
            onDetailOpen={onGitDetailOpen}
            onRepositoryState={onGitRepositoryState}
            onAskSelection={onAskSelection}
            onWalkthrough={onGitWalkthrough}
            onOpenWalkthrough={onOpenGitWalkthrough}
            onCloseWalkthrough={onCloseGitWalkthrough}
          />
        )}
      </div>
    </>
  );
}
