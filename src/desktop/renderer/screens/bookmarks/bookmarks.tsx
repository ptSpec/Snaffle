import { useState } from "react";
import type { DesktopThread, DesktopWorkspace, SavedMessage } from "../../../api.js";
import { MarkdownContent } from "../../sections/conversation/markdown.js";

export type BookmarksPage = "threads" | "messages";

export function Bookmarks({
  workspaces,
  messages,
  page,
  loadingMessages,
  onOpenThread,
  onRemoveThread,
  onOpenMessage,
  onDeleteMessage,
}: {
  workspaces: DesktopWorkspace[];
  messages: SavedMessage[];
  page: BookmarksPage;
  loadingMessages?: boolean;
  onOpenThread: (thread: DesktopThread) => void;
  onRemoveThread: (thread: DesktopThread) => void;
  onOpenMessage: (message: SavedMessage) => void;
  onDeleteMessage: (id: string) => void;
}): JSX.Element {
  const [expandedMessages, setExpandedMessages] = useState<string[]>([]);
  const threads = workspaces.flatMap((workspace) =>
    workspace.threads
      .filter((thread) => thread.bookmarked)
      .map((thread) => ({ thread, workspaceName: workspace.name })),
  );

  function toggleMessage(id: string): void {
    setExpandedMessages((expanded) =>
      expanded.includes(id) ? expanded.filter((savedId) => savedId !== id) : [...expanded, id],
    );
  }

  return (
    <section className="bookmarks view-enter" aria-label="Bookmarks">
      <div className="bookmarks-content">
        <p className="eyebrow">Library</p>
        <h1>{page === "threads" ? "Bookmarked threads" : "Saved messages"}</h1>

        {page === "threads" ? (
          threads.length === 0 ? (
            <p className="bookmark-empty">Threads you bookmark will appear here.</p>
          ) : (
            <div className="bookmark-thread-list">
              {threads.map(({ thread, workspaceName }) => (
                <article className="bookmark-thread" key={thread.id}>
                  <button type="button" onClick={() => onOpenThread(thread)}>
                    <span>{thread.title}</span>
                    <small>{workspaceName}</small>
                  </button>
                  <button
                    className="bookmark-remove"
                    type="button"
                    onClick={() => onRemoveThread(thread)}
                    aria-label={`Remove ${thread.title} from bookmarks`}
                    title="Remove bookmark"
                  >
                    ×
                  </button>
                </article>
              ))}
            </div>
          )
        ) : loadingMessages ? (
          <p className="bookmark-empty">Loading saved messages…</p>
        ) : messages.length === 0 ? (
          <p className="bookmark-empty">Messages you save from a conversation will appear here.</p>
        ) : (
          <div className="bookmark-message-list">
            {messages.map((message) => {
              const expanded = expandedMessages.includes(message.id);
              return (
              <article className={expanded ? "bookmark-message expanded" : "bookmark-message"} key={message.id}>
                <div
                  className="bookmark-message-body"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleMessage(message.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") toggleMessage(message.id);
                  }}
                  title={expanded ? "Collapse saved message" : "Show full saved message"}
                >
                  <span className="bookmark-source">
                    {message.workspaceName} · {message.threadTitle}
                  </span>
                  <div className="bookmark-message-text">
                    <MarkdownContent text={message.text} />
                  </div>
                  <span className="bookmark-meta">
                    {message.model ?? message.role}
                    {!message.sourceAvailable ? " · Source deleted" : ""}
                  </span>
                </div>
                <div className="bookmark-message-actions">
                  <button type="button" onClick={() => toggleMessage(message.id)}>
                    {expanded ? "Collapse" : "Show full message"}
                  </button>
                  {message.sourceAvailable ? (
                    <button type="button" onClick={() => onOpenMessage(message)}>
                      Open thread
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onDeleteMessage(message.id)}>
                    Remove
                  </button>
                </div>
              </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
