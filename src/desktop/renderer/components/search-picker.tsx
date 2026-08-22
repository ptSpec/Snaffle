import { useEffect, useMemo, useRef, useState } from "react";

export type SearchPickerOption = {
  value: string;
  label?: string;
  detail?: string | null;
};

export function SearchPicker({
  value,
  options,
  placeholder,
  searchPlaceholder,
  disabled,
  allowCustom = false,
  className = "",
  onChange,
}: {
  value: string;
  options: SearchPickerOption[];
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  allowCustom?: boolean;
  className?: string;
  onChange(value: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);
  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();
    return options
      .filter((option) => !search || `${option.label ?? ""} ${option.detail ?? ""} ${option.value}`.toLowerCase().includes(search))
      .slice(0, 100);
  }, [options, query]);

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  return (
    <div className={`search-picker ${className}`} ref={root}>
      <button
        className="search-picker-trigger"
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setActiveIndex(0);
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span>{selected?.label ?? (value || placeholder)}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open ? (
        <div className="search-picker-menu">
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => matches.length ? Math.min(current + 1, matches.length - 1) : 0);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              const next = matches[activeIndex]?.value ?? (allowCustom ? query.trim() : "");
              if (next) choose(next);
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <div className="search-picker-options">
            {matches.map((option, index) => {
              const detail = option.detail === null
                ? null
                : option.detail ?? (option.label && option.label !== option.value ? option.value : null);
              return (
                <button
                  className={index === activeIndex ? "active" : ""}
                  ref={index === activeIndex ? activeOption : undefined}
                  type="button"
                  key={option.value}
                  title={option.value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option.value)}
                >
                  <span>{option.label ?? option.value}</span>
                  {detail ? <small>{detail}</small> : null}
                </button>
              );
            })}
            {!matches.length ? <small className="search-picker-empty">No matches</small> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
