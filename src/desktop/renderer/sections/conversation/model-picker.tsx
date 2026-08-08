import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ModelProvider = {
  id: string;
  name: string;
  mark?: ReactNode;
  logo?: boolean;
  models: Array<{ value: string; label: string }>;
};

export function ModelPicker({
  value,
  providers,
  placeholder,
  searchPlaceholder,
  disabled,
  onChange,
}: {
  value: string;
  providers: ModelProvider[];
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  onChange(value: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const selectedProvider = providers.find((provider) => provider.models.some((model) => model.value === value))
    ?? providers[0];
  const showProviders = providers.length > 1;
  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();
    return providers.flatMap((provider) => provider.models.map((model) => ({ ...model, provider })))
      .filter((model) => providerId === "all" || model.provider.id === providerId)
      .filter((model) => !search || `${model.label} ${model.value} ${model.provider.name}`.toLowerCase().includes(search))
      .slice(0, 100);
  }, [providers, providerId, query]);

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
    <div className="model-picker" ref={root}>
      {selectedProvider?.mark ? (
        <span
          className={selectedProvider.logo ? "model-provider-mark logo" : "model-provider-mark"}
          title={selectedProvider.name}
          aria-label={selectedProvider.name}
        >
          {selectedProvider.mark}
        </span>
      ) : null}
      <button
        className="model-picker-trigger"
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setProviderId("all");
          setActiveIndex(0);
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span>{value || placeholder}</span><i aria-hidden="true">⌄</i>
      </button>
      {open ? (
        <div className={showProviders ? "model-picker-menu with-providers" : "model-picker-menu"}>
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
              const next = matches[activeIndex]?.value ?? query.trim();
              if (next) choose(next);
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <div className="model-picker-results">
            {showProviders ? (
              <nav className="model-provider-filter" aria-label="Filter models by provider">
                <button
                  type="button"
                  className={providerId === "all" ? "active" : ""}
                  title="All providers"
                  onClick={() => { setProviderId("all"); setActiveIndex(0); }}
                >✦</button>
                {providers.map((provider) => (
                  <button
                    type="button"
                    className={providerId === provider.id ? "active" : ""}
                    title={provider.name}
                    key={provider.id}
                    onClick={() => { setProviderId(provider.id); setActiveIndex(0); }}
                  >{provider.mark ?? provider.name.slice(0, 2)}</button>
                ))}
              </nav>
            ) : null}
            <div className="model-picker-options">
              {matches.map((model, index) => (
                <button
                  className={index === activeIndex ? "active" : ""}
                  ref={index === activeIndex ? activeOption : undefined}
                  type="button"
                  key={`${model.provider.id}:${model.value}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(model.value)}
                >
                  <span>{model.label}</span>
                  <small>{showProviders ? `${model.provider.name} · ${model.value}` : model.value}</small>
                </button>
              ))}
              {!matches.length ? <small className="model-picker-empty">No matches</small> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
