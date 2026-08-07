import { useEffect, useState } from "react";

export function EditorSettings({
  command,
  argumentsTemplate,
  error,
  onChange,
  onChoose,
}: {
  command: string;
  argumentsTemplate: string;
  error: string | null;
  onChange: (command: string, argumentsTemplate: string) => void;
  onChoose: () => void;
}): JSX.Element {
  const [commandInput, setCommandInput] = useState(command);
  const [argumentsInput, setArgumentsInput] = useState(argumentsTemplate);
  useEffect(() => setCommandInput(command), [command]);
  useEffect(() => setArgumentsInput(argumentsTemplate), [argumentsTemplate]);

  function save(): void {
    onChange(commandInput.trim(), argumentsInput.trim());
  }

  return (
    <section className="settings view-enter" aria-label="Editor settings">
      <div className="settings-content">
        <p className="eyebrow">Settings</p>
        <h1>Editor</h1>
        <p className="settings-description">Choose which application opens files from the Git panel.</p>

        <div className="editor-current">
          <span>Current editor</span>
          <strong title={command || "System default"}>{command || "System default"}</strong>
        </div>
        <div className="editor-actions">
          <button className="primary" type="button" onClick={onChoose}>Choose application…</button>
          <button type="button" disabled={!command} onClick={() => onChange("", "")}>Use system default</button>
        </div>

        <label className="setting-field text-setting">
          <span>
            <strong>Command (advanced)</strong>
            <small>Optionally enter an executable path or CLI command manually.</small>
          </span>
          <input
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setCommandInput(command);
            }}
            placeholder="code-insiders"
          />
        </label>
        <label className="setting-field text-setting">
          <span>
            <strong>Arguments (advanced)</strong>
            <small>Leave blank to pass the file. Use {"{path}"} for the file or {"{folder}"} for its folder.</small>
          </span>
          <input
            value={argumentsInput}
            onChange={(event) => setArgumentsInput(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setArgumentsInput(argumentsTemplate);
            }}
            placeholder="--goto {path}"
          />
        </label>

        {error ? <p className="settings-error">{error}</p> : null}
      </div>
    </section>
  );
}


