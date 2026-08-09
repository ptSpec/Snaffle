import type { DesktopWorkspace } from "../../../api.js";
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
  onCollapse(): void;
}): JSX.Element {
  return (
    <>
      <div className="section-heading inspector-heading">
        <div className="inspector-tabs" role="tablist" aria-label="Right panel">
          <button className={tab === "inspect" ? "active" : ""} type="button" onClick={() => onTab("inspect")}>Inspect</button>
          <button className={tab === "git" ? "active" : ""} type="button" onClick={() => onTab("git")}>Git</button>
        </div>
        <button className="panel-toggle" type="button" onClick={onCollapse} aria-label="Hide right panel" title="Hide right panel">
          <span className="pane-icon right" aria-hidden="true" />
        </button>
      </div>

      {tab === "inspect" ? (
        <div className="inspector-content">
          {selectedItem ? (
            <>
              <button className="execution-back" type="button" onClick={() => onSelect(null)}>‹ Overview</button>
              <Inspector
                item={selectedItem}
                timeline={timeline}
                instructions={modelInstructions}
                tools={toolSpecs}
              />
            </>
          ) : (
            <ExecutionOverview
              timeline={timeline}
              running={running}
              selectedModel={selectedModel}
              selectedProviderConnectionId={selectedProviderConnectionId}
              providerNames={providerNames}
              onSelect={onSelect}
              onNavigateTurn={onNavigateTurn}
            />
          )}
        </div>
      ) : (
        <GitPanel workspace={workspace} running={running} onEditorOpen={onEditorOpen} />
      )}
    </>
  );
}
