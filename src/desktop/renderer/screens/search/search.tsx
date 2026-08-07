import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DesktopSearchResult } from "../../../api.js";

export function Search({
  onOpen,
  onError,
}: {
  onOpen: (result: DesktopSearchResult) => void;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DesktopSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setResults([]);
      setSearching(false);
      return;
    }
    let current = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void window.desktop.searchConversations(value).then(
        (matches) => {
          if (!current) return;
          setResults(matches);
          setCursor(0);
          setSearching(false);
          onError(null);
        },
        (cause: unknown) => {
          if (!current) return;
          setSearching(false);
          onError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    }, 140);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, onError]);

  function handleKeys(event: KeyboardEvent<HTMLInputElement>): void {
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const movement = event.key === "ArrowDown" ? 1 : -1;
      setCursor((value) => Math.max(0, Math.min(results.length - 1, value + movement)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      onOpen(results[cursor]!);
    }
  }

  return (
    <section className="search-screen view-enter" aria-label="Search conversations">
      <div className="search-content">
        <p className="eyebrow">History</p>
        <h1>Search conversations</h1>
        <div className="conversation-search-box">
          <SearchIcon />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeys}
            placeholder="Search every workspace…"
            aria-label="Search every workspace"
          />
          {searching ? <span>Searching…</span> : null}
        </div>

        {!query.trim() ? (
          <p className="search-empty">Search user and assistant messages across all workspaces.</p>
        ) : !searching && results.length === 0 ? (
          <p className="search-empty">No matching messages.</p>
        ) : (
          <div className="conversation-search-results">
            {results.map((result, index) => (
              <button
                key={result.entryId}
                className={index === cursor ? "active" : undefined}
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => onOpen(result)}
              >
                <span className="search-result-title">{result.threadTitle}</span>
                <span className="search-result-excerpt">{result.excerpt}</span>
                <small>{result.workspaceName} · {result.role === "user" ? "You" : "Assistant"}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </svg>
  );
}
