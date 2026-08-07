import type { DesktopWorkspace } from "../../../api.js";
import type { TimelineItem } from "../conversation/timeline-state.js";
import { Inspector } from "./inspect.js";
import { GitPanel } from "./git/panel.js";

export type InspectorTab = "inspect" | "git";

export function InspectorPanel({
  workspace,
  selectedItem,
  running,
  tab,
  onTab,
  onEditorOpen,
  onCollapse,
}: {
  workspace: DesktopWorkspace | null;
  selectedItem: TimelineItem | null | undefined;
  running: boolean;
  tab: InspectorTab;
  onTab(tab: InspectorTab): void;
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
          {selectedItem ? <Inspector item={selectedItem} /> : <p className="inspector-empty">Select a tool call to inspect it.</p>}
        </div>
      ) : (
        <GitPanel workspace={workspace} running={running} onEditorOpen={onEditorOpen} />
      )}
    </>
  );
}
