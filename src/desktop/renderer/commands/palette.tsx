import { useEffect, useMemo, useRef, useState } from "react";

export type AppCommand = {
  id: string;
  label: string;
  detail?: string;
  keywords?: string;
  shortcut?: string;
  scope?: "all" | "chat";
  active?: boolean;
  disabled?: boolean;
  searchOnly?: boolean;
  run(): void;
};

export function CommandPalette({ mode, commands, onClose }: {
  mode: "all" | "slash";
  commands: AppCommand[];
  onClose(): void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const words = query.toLowerCase().trim();
    return commands.filter((command) => {
      if (mode === "slash" && command.scope !== "chat") return false;
      if (!words && command.searchOnly) return false;
      return !words || `${command.label} ${command.detail ?? ""} ${command.keywords ?? ""}`
        .toLowerCase()
        .includes(words);
    });
  }, [commands, mode, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSelected((value) => {
    const bounded = Math.min(value, Math.max(visible.length - 1, 0));
    if (!visible[bounded]?.disabled) return bounded;
    const firstEnabled = visible.findIndex((command) => !command.disabled);
    return firstEnabled < 0 ? 0 : firstEnabled;
  }), [visible]);

  function move(direction: 1 | -1): void {
    if (visible.length === 0) return;
    let next = selected;
    do next = (next + direction + visible.length) % visible.length;
    while (visible[next]?.disabled && next !== selected);
    setSelected(next);
  }

  function choose(command: AppCommand | undefined): void {
    if (!command || command.disabled) return;
    onClose();
    command.run();
  }

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(visible[selected]);
            }
          }}
          placeholder={mode === "slash" ? "Type a chat command…" : "Search commands…"}
          aria-label="Search commands"
        />
        <div className="command-palette-list" role="listbox">
          {visible.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === selected}
              className={index === selected ? "selected" : undefined}
              disabled={command.disabled}
              onMouseMove={() => setSelected(index)}
              onClick={() => choose(command)}
            >
              <span className="command-palette-mark" aria-hidden="true">{command.active ? "✓" : ""}</span>
              <span className="command-palette-copy">
                <strong>{command.label}</strong>
                {command.detail ? <small>{command.detail}</small> : null}
              </span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          ))}
          {visible.length === 0 ? <p>No matching commands</p> : null}
        </div>
      </section>
    </div>
  );
}
