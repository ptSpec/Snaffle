import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProviderModelVariant } from "../../../../providers/provider.js";
import { applyModelVariant, splitModelVariant } from "../../../../providers/profiles.js";

export type ModelProvider = {
  id: string;
  name: string;
  mark?: ReactNode;
  logo?: boolean;
  variants?: ProviderModelVariant[];
  models: Array<{ value: string; label: string }>;
};

export function ModelPicker({
  value,
  providerId: selectedProviderId,
  providers,
  placeholder,
  searchPlaceholder,
  disabled,
  onChange,
}: {
  value: string;
  providerId: string;
  providers: ModelProvider[];
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  onChange(providerId: string, value: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
    ?? providers[0];
  const selection = splitModelVariant(value, selectedProvider?.variants);
  const selectedVariant = selectedProvider?.variants?.find((variant) => variant.id === selection.variantId);
  const showVariants = Boolean(value && selection.routable && selectedProvider?.variants?.length);
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
    if (!showVariants) setVariantOpen(false);
  }, [showVariants]);

  useEffect(() => {
    if (!open && !variantOpen) return;
    const close = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setVariantOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, variantOpen]);

  function choose(providerId: string, next: string): void {
    const preserveVariant = providerId === selectedProvider?.id ? selection.variantId : "";
    const provider = providers.find((item) => item.id === providerId);
    onChange(providerId, applyModelVariant(next, preserveVariant, provider?.variants));
    setOpen(false);
    setVariantOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function chooseVariant(variantId: string): void {
    if (!selectedProvider) return;
    onChange(selectedProvider.id, applyModelVariant(value, variantId, selectedProvider.variants));
    setVariantOpen(false);
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
          setVariantOpen(false);
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span>{(selection.routable ? selection.baseModelId : value) || placeholder}</span><PickerCaret />
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
              const match = matches[activeIndex];
              const next = match?.value ?? query.trim();
              if (next) choose(match?.provider.id ?? selectedProvider?.id ?? "", next);
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
                >
                  <svg className="all-providers-mark" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 2.8c.7 3.8 3.4 6.5 7.2 7.2-3.8.7-6.5 3.4-7.2 7.2-.7-3.8-3.4-6.5-7.2-7.2C6.6 9.3 9.3 6.6 10 2.8Z" />
                  </svg>
                </button>
                {providers.map((provider) => (
                  <button
                    type="button"
                    className={providerId === provider.id ? "active" : ""}
                    title={provider.name}
                    key={provider.id}
                    onClick={() => { setProviderId(provider.id); setActiveIndex(0); }}
                  >
                    <span className={provider.logo ? "provider-filter-mark logo" : "provider-filter-mark"}>
                      {provider.mark ?? provider.name.slice(0, 2)}
                    </span>
                  </button>
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
                  onClick={() => choose(model.provider.id, model.value)}
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
      <div className={showVariants ? "model-variant-picker visible" : "model-variant-picker"}>
          <button
            className="model-variant-trigger"
            type="button"
            disabled={disabled || !showVariants}
            title="Model routing"
            aria-label={`Model routing: ${selectedVariant?.label ?? "Default"}`}
            aria-expanded={variantOpen}
            aria-hidden={!showVariants}
            onClick={() => {
              setOpen(false);
              setVariantOpen((current) => !current);
            }}
          >
            <span>{selectedVariant?.label ?? "Default"}</span><PickerCaret />
          </button>
          {showVariants && variantOpen ? (
            <div className="model-variant-menu">
              {selectedProvider?.variants?.map((variant) => (
                <button
                  className={variant.id === selection.variantId ? "active" : ""}
                  type="button"
                  key={variant.id || "default"}
                  onClick={() => chooseVariant(variant.id)}
                >
                  <span>{variant.label}</span>
                  <small>{variant.description}</small>
                </button>
              ))}
            </div>
          ) : null}
      </div>
    </div>
  );
}

function PickerCaret(): JSX.Element {
  return (
    <svg className="model-picker-caret" viewBox="0 0 10 10" aria-hidden="true">
      <path d="m3 1 4 4-4 4" />
    </svg>
  );
}
