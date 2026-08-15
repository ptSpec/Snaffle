import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { KeptAsideMessage } from "../../../api.js";
import { MarkdownContent } from "./markdown.js";

export function AsideShelf({
  messages,
  onOpen,
  onRemove,
}: {
  messages: KeptAsideMessage[];
  onOpen: (entryId: string) => void;
  onRemove: (entryId: string) => void;
}): JSX.Element | null {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (openId && !messages.some((message) => message.entryId === openId)) setOpenId(null);
  }, [messages, openId]);

  useEffect(() => {
    if (!openId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [openId]);

  if (!messages.length) return null;

  return (
    <aside className={openId ? "aside-shelf has-open" : "aside-shelf"} aria-label="Kept aside messages">
      {messages.map((message, index) => {
        const selected = message.entryId === openId;
        const label = `Assistant message ${index + 1}: ${summary(message.text)}`;
        return (
          <article
            className={selected ? `aside-card depth-${index + 1} open` : `aside-card depth-${index + 1}`}
            key={message.entryId}
            {...(!selected ? {
              role: "button",
              tabIndex: 0,
              "aria-label": label,
              "aria-expanded": false,
              onClick: () => setOpenId(message.entryId),
              onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setOpenId(message.entryId);
              },
            } : {
              "aria-label": "Kept aside assistant message",
            })}
          >
            {selected ? (
              <>
                <header>
                  <span>Kept aside · Assistant message</span>
                  <button type="button" onClick={() => setOpenId(null)} aria-label="Tuck message aside" title="Tuck aside">
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="m6 3.5 5 4.5-5 4.5" />
                    </svg>
                  </button>
                </header>
                <div className="aside-card-content">
                  <MarkdownContent text={message.text} />
                </div>
                <footer>
                  <button type="button" onClick={() => {
                    setOpenId(null);
                    onOpen(message.entryId);
                  }}>Open in conversation</button>
                  <button type="button" onClick={() => onRemove(message.entryId)}>Remove</button>
                </footer>
              </>
            ) : null}
          </article>
        );
      })}
    </aside>
  );
}

function summary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 71)}…` : compact;
}
