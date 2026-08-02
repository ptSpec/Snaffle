import type { SavedMessage } from "../api.js";
import { MarkdownContent } from "./timeline.js";

export function SavedMessages({
  messages,
  onOpen,
  onDelete,
}: {
  messages: SavedMessage[];
  onOpen: (message: SavedMessage) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  return (
    <section className="saved-messages view-enter" aria-label="Saved messages">
      <div className="saved-messages-content">
        <p className="eyebrow">Library</p>
        <h1>Saved messages</h1>
        {messages.length === 0 ? (
          <p className="saved-empty">Messages you save from a conversation will appear here.</p>
        ) : (
          <div className="saved-message-list">
            {messages.map((message) => (
              <article className="saved-message" key={message.id}>
                <div
                  className="saved-message-body"
                  role={message.sourceAvailable ? "button" : undefined}
                  tabIndex={message.sourceAvailable ? 0 : undefined}
                  onClick={() => message.sourceAvailable && onOpen(message)}
                  onKeyDown={(event) => {
                    if (message.sourceAvailable && event.key === "Enter") onOpen(message);
                  }}
                  title={message.sourceAvailable ? "Open source message" : "Source conversation was deleted"}
                >
                  <span className="saved-message-source">
                    {message.workspaceName} · {message.threadTitle}
                  </span>
                  <span className="saved-message-text">
                    <MarkdownContent text={message.text} />
                  </span>
                  <span className="saved-message-meta">
                    {message.model ?? message.role}
                    {!message.sourceAvailable ? " · Source deleted" : ""}
                  </span>
                </div>
                <button
                  className="saved-message-delete"
                  type="button"
                  onClick={() => onDelete(message.id)}
                  aria-label="Delete saved message"
                  title="Delete saved message"
                >
                  ×
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
