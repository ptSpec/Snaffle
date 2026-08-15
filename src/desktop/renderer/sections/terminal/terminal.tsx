import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_FONT = '"Snaffle Terminal", monospace';

export function TerminalPanel({
  workspaceId,
  workspaceName,
  themeId,
  onClose,
  onError,
}: {
  workspaceId: string;
  workspaceName: string;
  themeId: string;
  onClose: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal>();
  const fitRef = useRef<FitAddon>();

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void mount(element);

    async function mount(terminalElement: HTMLDivElement): Promise<void> {
      await document.fonts.load(`13px ${TERMINAL_FONT}`);
      if (disposed) return;

      const styles = getComputedStyle(document.documentElement);
      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: TERMINAL_FONT,
        fontSize: 13,
        lineHeight: 1.25,
        scrollback: 5_000,
        theme: {
          background: styles.getPropertyValue("--code-background").trim(),
          foreground: styles.getPropertyValue("--code-text").trim(),
          cursor: styles.getPropertyValue("--editor-cursor").trim(),
          selectionBackground: styles.getPropertyValue("--editor-selection-background").trim(),
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(terminalElement);
      terminalRef.current = terminal;
      fitRef.current = fit;

      const removeDataListener = window.desktop.onTerminalData((event) => {
        if (event.workspaceId === workspaceId) terminal.write(event.data);
      });
      const removeExitListener = window.desktop.onTerminalExit((event) => {
        if (event.workspaceId !== workspaceId) return;
        terminal.write(`\r\n\x1b[90mProcess exited with code ${event.exitCode}\x1b[0m\r\n`);
      });
      const input = terminal.onData((data) => {
        void window.desktop.writeTerminal(workspaceId, data).catch((cause) => {
          onError(errorMessage(cause));
        });
      });
      const resize = new ResizeObserver(() => {
        fit.fit();
        void window.desktop.resizeTerminal(workspaceId, terminal.cols, terminal.rows);
      });
      resize.observe(terminalElement);

      const frame = window.requestAnimationFrame(() => {
        fit.fit();
        void window.desktop.openTerminal(workspaceId, terminal.cols, terminal.rows).then(
          () => terminal.focus(),
          (cause: unknown) => onError(errorMessage(cause)),
        );
      });

      cleanup = () => {
        window.cancelAnimationFrame(frame);
        resize.disconnect();
        input.dispose();
        removeDataListener();
        removeExitListener();
        terminal.dispose();
        terminalRef.current = undefined;
        fitRef.current = undefined;
      };
    }

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [workspaceId, themeId]);

  async function restart(): Promise<void> {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    try {
      await window.desktop.closeTerminal(workspaceId);
      terminal.reset();
      fit.fit();
      await window.desktop.openTerminal(workspaceId, terminal.cols, terminal.rows);
      terminal.focus();
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  return (
    <section className="terminal-panel" aria-label={`Terminal for ${workspaceName}`}>
      <header className="terminal-header">
        <span className="terminal-title">
          <TerminalIcon />
          <span>{workspaceName}</span>
        </span>
        <span className="terminal-actions">
          <button
            type="button"
            onClick={() => void restart()}
            aria-label="Restart terminal"
            title="Restart terminal"
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide terminal"
            title="Hide terminal"
          >
            <CloseIcon />
          </button>
        </span>
      </header>
      <div ref={container} className="terminal-view" />
    </section>
  );
}

function TerminalIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4.5 6 3.5 3.5L4.5 13M10 13h5" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </svg>
  );
}

function RestartIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15 7V3.8l-2 2A6 6 0 1 0 16 11" />
    </svg>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
