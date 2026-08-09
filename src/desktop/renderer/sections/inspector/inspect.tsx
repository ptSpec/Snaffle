import { JsonInspector } from "./json-inspector.js";
import { labelFor, toolGeneratingLabel, toolStatus, type TimelineItem } from "../conversation/timeline-state.js";
import { SubagentInspector } from "./subagent.js";

export function Inspector({ item }: { item: TimelineItem }): JSX.Element {
  if (item.kind === "activity-group") {
    return <div className="inspector-card">Work details</div>;
  }
  if (item.kind === "tool-preparing") {
    return <div className="inspector-card">{toolGeneratingLabel(item.name)}</div>;
  }
  if (item.kind === "approval") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">Command approval</p>
        <JsonInspector value={{ command: item.command, cwd: item.cwd, reason: item.reason }} />
      </div>
    );
  }
  if (item.kind !== "tool") {
    return (
      <div className="inspector-card">
        <p className="eyebrow">{labelFor(item.kind)}</p>
        <p>{item.text}</p>
      </div>
    );
  }

  const status = toolStatus(item);
  if (item.call.name === "delegate_task" && item.details) {
    return <SubagentInspector activity={item.details} />;
  }
  return (
    <div className="inspector-card">
      <p className="eyebrow">Tool call</p>
      <h3>{item.call.name}</h3>
      <p className={`inspector-status ${status.className}`}>
        {status.marker} {status.label}
      </p>
      {item.call.inputRepair ? (
        <p className="inspector-repair"><strong>Input healed</strong> · {item.call.inputRepair}</p>
      ) : null}
      <h4>Input</h4>
      <JsonInspector value={item.call.input} />
      {item.phase === "completed" ? (
        <>
          <h4>Output</h4>
          <pre>{item.content || "No output"}</pre>
        </>
      ) : (
        <p className="muted">Waiting for the tool result.</p>
      )}
    </div>
  );
}

