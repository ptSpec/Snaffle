import {
  SPEECH_MODELS,
  type SpeechModel,
  type SpeechModelStatus,
  type SpeechSettings,
} from "../../../../speech/config.js";

export function VoiceSettings({
  settings,
  error,
  onChange,
  models,
  onInstall,
  onRemove,
}: {
  settings: SpeechSettings;
  error: string | null;
  onChange: (settings: SpeechSettings) => void;
  models: SpeechModelStatus[];
  onInstall: (model: SpeechModel) => void;
  onRemove: (model: SpeechModel) => void;
}): JSX.Element {
  const availableModels = window.desktop.platform === "darwin"
    ? SPEECH_MODELS
    : SPEECH_MODELS.filter((model) => model.id !== "qwen3-asr-1.7b");
  const selectedModel = availableModels.find((model) => model.id === settings.localModel) ?? availableModels[0]!;
  const status = models.find((model) => model.id === settings.localModel) ?? {
    id: settings.localModel,
    phase: "missing" as const,
    progress: 0,
    detail: "Checking…",
  };

  return (
    <section className="settings view-enter" aria-label="Voice settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Voice</h1>
        <p className="settings-description">
          Dictate into the composer with live partial text. Local model weights download only when you request them.
        </p>

        <label className="setting-field">
          <span>
            <strong>Voice input</strong>
            <small>Show the microphone beside the send button.</small>
          </span>
          <input
            className="selection-checkbox"
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => onChange({ ...settings, enabled: event.target.checked })}
          />
        </label>

        <label className="setting-field voice-model-setting">
            <span>
              <strong>On-device model</strong>
              <small>{selectedModel.detail}</small>
            </span>
            <select
              value={settings.localModel}
              onChange={(event) => onChange({ ...settings, localModel: event.target.value as SpeechModel })}
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <div className="setting-field voice-model-status">
            <span>
              <strong>Model status</strong>
              <small>{status.detail}</small>
            </span>
            <strong>{status.phase === "ready" ? "Installed" : status.phase === "unavailable" ? "Unavailable" : status.phase === "installing" ? "Installing" : status.phase === "downloading" ? `${Math.round(status.progress * 100)}%` : "Not installed"}</strong>
          </div>
          {status.phase === "downloading" || status.phase === "installing" ? (
            <progress className="voice-download-progress" max={1} value={status.progress} />
          ) : null}
          <div className="editor-actions voice-model-actions">
            {status.phase === "ready" ? (
              <button type="button" onClick={() => onRemove(settings.localModel)}>Delete model</button>
            ) : (
              <button
                className="primary"
                type="button"
                disabled={status.phase === "unavailable" || status.phase === "downloading" || status.phase === "installing"}
                onClick={() => onInstall(settings.localModel)}
              >Download model</button>
            )}
          </div>
          <label className="setting-field">
            <span>
              <strong>Keep speech model loaded</strong>
              <small>Otherwise unload it after five minutes without recording.</small>
            </span>
            <input
              className="selection-checkbox"
              type="checkbox"
              checked={settings.keepModelLoaded}
              onChange={(event) => onChange({ ...settings, keepModelLoaded: event.target.checked })}
            />
          </label>

        <label className="setting-field">
          <span>
            <strong>Stop after silence</strong>
            <small>Recording will stop after detecting 8 seconds of silence.</small>
          </span>
          <input
            className="selection-checkbox"
            type="checkbox"
            checked={settings.autoStopOnSilence}
            onChange={(event) => onChange({ ...settings, autoStopOnSilence: event.target.checked })}
          />
        </label>

        <div className="settings-note" role="note">
          Parakeet updates in buffered intervals. Streaming models provide live partial text.
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}
