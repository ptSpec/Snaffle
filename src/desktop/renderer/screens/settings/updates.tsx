import type { DesktopUpdateState } from "../../../api.js";

export function UpdateSettings({
  state,
  activeRun,
  onCheck,
  onApply,
}: {
  state: DesktopUpdateState;
  activeRun: boolean;
  onCheck(): void;
  onApply(): void;
}): JSX.Element {
  const checking = state.status === "checking";
  const downloading = state.status === "downloading";
  const canCheck = state.status !== "disabled" && !checking && !downloading && state.status !== "ready";
  const description = statusDescription(state);
  const action = state.status === "available" && !state.automatic
    ? "Download update"
    : state.status === "ready"
      ? "Restart to update"
      : null;

  return (
    <section className="settings view-enter" aria-label="Update settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Updates</h1>

        <section className="update-card">
          <div className="update-status-heading">
            <span>
              <strong>{statusTitle(state)}</strong>
              <small>Installed version {state.currentVersion}</small>
            </span>
            {state.availableVersion ? <span className="update-version">v{state.availableVersion}</span> : null}
          </div>

          {description ? <p>{description}</p> : null}

          {state.status === "available" && !state.automatic ? (
            <p className="update-macos-note">
              This app is not currently signed or notarized for macOS. If macOS prevents it from
              opening, run the following command: <code>xattr -cr /Applications/Snaffle.app</code>
            </p>
          ) : null}

          {downloading ? (
            <div className="update-progress" aria-label={`Update download ${state.progress ?? 0}% complete`}>
              <span style={{ width: `${state.progress ?? 0}%` }} />
            </div>
          ) : null}

          <div className="editor-actions update-actions">
            {canCheck ? <button type="button" onClick={onCheck}>Check now</button> : null}
            {action ? (
              <button
                className="primary"
                type="button"
                onClick={onApply}
                disabled={state.status === "ready" && activeRun}
              >
                {action}
              </button>
            ) : null}
          </div>

          {state.status === "ready" && activeRun ? (
            <small className="update-run-note">Finish or stop active model runs before restarting.</small>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function statusTitle(state: DesktopUpdateState): string {
  switch (state.status) {
    case "disabled": return "Development build";
    case "checking": return "Checking for updates";
    case "current": return "Snaffle is up to date";
    case "available": return state.automatic ? "Update available" : "New version available";
    case "downloading": return `Downloading update · ${state.progress ?? 0}%`;
    case "ready": return "Update ready";
    case "error": return "Could not check for updates";
    default: return "Automatic update checks";
  }
}

function statusDescription(state: DesktopUpdateState): string | null {
  switch (state.status) {
    case "disabled": return "Update checks run in packaged builds.";
    case "checking": return "Looking for the latest Snaffle release.";
    case "current": return "No newer release is available.";
    case "available": return state.automatic ? "The update will download in the background." : null;
    case "downloading": return "You can keep working while the update downloads.";
    case "ready": return "Restart when convenient to install the downloaded update.";
    case "error": return state.message ?? "Try checking again in a moment.";
    default: return "Snaffle checks shortly after launch and then twice a day.";
  }
}
