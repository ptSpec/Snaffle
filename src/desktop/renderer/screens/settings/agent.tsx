import { NumberSetting } from "./controls.js";

export function AgentSettings({
  maxSteps,
  providerTimeoutMinutes,
  providerRetries,
  error,
  onMaxSteps,
  onProviderTimeoutMinutes,
  onProviderRetries,
}: {
  maxSteps: number;
  providerTimeoutMinutes: number;
  providerRetries: number;
  error: string | null;
  onMaxSteps: (maxSteps: number) => void;
  onProviderTimeoutMinutes: (minutes: number) => void;
  onProviderRetries: (retries: number) => void;
}): JSX.Element {
  return (
    <section className="settings view-enter" aria-label="Agent settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Agent</h1>
        <p className="settings-description">Control the limits applied to new runs.</p>

        <NumberSetting
          label="Maximum turns"
          description="Maximum model turns per run, from 1 to 200."
          value={maxSteps}
          min={1}
          max={200}
          onChange={onMaxSteps}
        />
        <NumberSetting
          label="Provider inactivity timeout"
          description="Retry when a provider stream sends no data for this many minutes."
          value={providerTimeoutMinutes}
          min={1}
          max={30}
          onChange={onProviderTimeoutMinutes}
        />
        <NumberSetting
          label="Provider retries"
          description="Additional attempts after a provider request or stream fails."
          value={providerRetries}
          min={0}
          max={10}
          onChange={onProviderRetries}
        />

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}


