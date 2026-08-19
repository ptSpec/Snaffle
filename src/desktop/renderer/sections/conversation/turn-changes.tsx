import { useState } from "react";
import type { TurnChangesArtifact, TurnChangesSummary } from "../../../api.js";

export function TurnChanges({ summary }: { summary: TurnChangesSummary }): JSX.Element {
  const [artifact, setArtifact] = useState<TurnChangesArtifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  function load(open: boolean): void {
    if (!open || artifact || loading || failed) return;
    setLoading(true);
    void window.desktop.getTurnChanges(summary.id).then(
      (value) => {
        setArtifact(value);
        setFailed(!value);
      },
      () => setFailed(true),
    ).finally(() => setLoading(false));
  }

  return (
    <details className="turn-changes" onToggle={(event) => load(event.currentTarget.open)}>
      <summary>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m5 6 3 3 3-3" />
        </svg>
        <span>{summary.files} {summary.files === 1 ? "file" : "files"} changed</span>
        <b>+{summary.additions}</b>
        <i>−{summary.deletions}</i>
      </summary>
      <div className="turn-changes-body">
        {loading ? <p>Loading diff…</p> : failed ? <p>The saved diff is unavailable.</p> : artifact ? (
          <>
            {artifact.patch ? (
              <pre><code>{displayLines(artifact.patch).map((line, index) => (
                <span className={line.kind} key={`${index}:${line.text}`}>{line.text || " "}</span>
              ))}</code></pre>
            ) : <p>The diff was too large to store.</p>}
            {artifact.truncated && artifact.patch ? <small>Diff truncated</small> : null}
          </>
        ) : null}
      </div>
    </details>
  );
}

function displayLines(patch: string): Array<{ kind: string; text: string }> {
  return patch.split("\n").flatMap((line) => {
    if (line.startsWith("diff --git ")) {
      const destination = line.lastIndexOf(" b/");
      const path = destination >= 0 ? line.slice(destination + 3).replace(/^"|"$/g, "") : "Changed file";
      return [{ kind: "file", text: path }];
    }
    if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) return [];
    if (line.startsWith("Binary files ")) return [{ kind: "binary", text: "Binary file changed" }];
    if (line.startsWith("@@")) {
      const context = line.replace(/^@@.*?@@\s*/, "");
      return [{ kind: "hunk", text: context ? `Changed section · ${context}` : "Changed section" }];
    }
    if (line.startsWith("+")) return [{ kind: "added", text: line }];
    if (line.startsWith("-")) return [{ kind: "removed", text: line }];
    return [{ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line }];
  });
}
