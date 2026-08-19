import { useLayoutEffect, useRef } from "react";
import type { CodeSelectionInput, DesktopWorkspace } from "../../../api.js";
import type { TimelineItem } from "../conversation/timeline-state.js";
import { ExecutionOverview } from "./overview.js";
import { Inspector } from "./inspect.js";
import { GitPanel } from "./git/panel.js";
import type { ToolSpec } from "../../../../protocol.js";

export type InspectorTab = "inspect" | "git";

export function InspectorPanel({
  workspace,
  selectedItem,
  timeline,
  running,
  selectedModel,
  selectedProviderConnectionId,
  providerNames,
  modelInstructions,
  toolSpecs,
  tab,
  onTab,
  onSelect,
  onNavigateTurn,
  onEditorOpen,
  onAskSelection,
  onCollapse,
}: {
  workspace: DesktopWorkspace | null;
  selectedItem: TimelineItem | null | undefined;
  timeline: TimelineItem[];
  running: boolean;
  selectedModel: string;
  selectedProviderConnectionId: string;
  providerNames: Record<string, string>;
  modelInstructions: string[];
  toolSpecs: ToolSpec[];
  tab: InspectorTab;
  onTab(tab: InspectorTab): void;
  onSelect(id: string | null): void;
  onNavigateTurn(id: string): void;
  onEditorOpen(open: boolean): void;
  onAskSelection(input: CodeSelectionInput): Promise<void>;
  onCollapse(): void;
}): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const overviewScrollTop = useRef(0);
  const followLiveRun = useRef(true);
  const wasRunning = useRef(false);

  useLayoutEffect(() => {
    if (!selectedItem && contentRef.current) contentRef.current.scrollTop = overviewScrollTop.current;
  }, [selectedItem]);

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

  return (
    <>
      <div className="section-heading inspector-heading">
        <div className="inspector-tabs" role="tablist" aria-label="Right panel">
          <button className={tab === "inspect" ? "active" : ""} type="button" role="tab" aria-selected={tab === "inspect"} onClick={() => onTab("inspect")}>Inspect</button>
          <button className={tab === "git" ? "active" : ""} type="button" role="tab" aria-selected={tab === "git"} onClick={() => onTab("git")}>Git</button>
        </div>
        <button className="panel-toggle" type="button" onClick={onCollapse} aria-label="Hide right panel" title="Hide right panel">
          <span className="pane-icon right" aria-hidden="true" />
        </button>
      </div>

      {tab === "inspect" ? (
        <div className="inspector-content" ref={contentRef} onScroll={trackOverviewScroll}>
          {selectedItem ? (
            <div className="inspector-view inspector-view-detail">
              <button className="execution-back" type="button" onClick={() => onSelect(null)}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m9.75 3.5-4.5 4.5 4.5 4.5" />
                </svg>
                <span>Back</span>
              </button>
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
      ) : (
        <GitPanel
          workspace={workspace}
          running={running}
          onEditorOpen={onEditorOpen}
          onAskSelection={onAskSelection}
        />
      )}
    </>
  );
}
