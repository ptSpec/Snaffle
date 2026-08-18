import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  ProviderAllowance,
  ProviderAllowanceItem,
  ProviderModelReasoning,
  ProviderModelVariant,
  ReasoningEffort,
} from "../../../../providers/provider.js";
import { applyModelVariant, splitModelVariant } from "../../../../providers/profiles.js";

export type ModelProvider = {
  id: string;
  name: string;
  mark?: ReactNode;
  logo?: boolean;
  providesAllowance?: boolean;
  variants?: ProviderModelVariant[];
  models: Array<{
    value: string;
    label: string;
    reasoning?: ProviderModelReasoning;
  }>;
};

export function ModelPicker({
  value,
  providerId: selectedProviderId,
  providers,
  placeholder,
  searchPlaceholder,
  disabled,
  allowance,
  reasoningEffort,
  onAllowance,
  onChange,
  onReasoningEffort,
}: {
  value: string;
  providerId: string;
  providers: ModelProvider[];
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  allowance: ProviderAllowance | null | undefined;
  reasoningEffort: ReasoningEffort | "";
  onAllowance(): void;
  onChange(providerId: string, value: string): void;
  onReasoningEffort(value: ReasoningEffort | ""): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
    ?? providers[0];
  const selection = splitModelVariant(value, selectedProvider?.variants);
  const selectedModel = selectedProvider?.models.find((model) => model.value === value) ??
    selectedProvider?.models.find((model) => model.value === selection.baseModelId);
  const selectedVariant = selectedProvider?.variants?.find((variant) => variant.id === selection.variantId);
  const showVariants = Boolean(value && selection.routable && selectedProvider?.variants?.length);
  const showReasoning = Boolean(selectedModel?.reasoning?.efforts.length);
  const showOptions = showVariants || showReasoning;
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
    if (!showOptions) setVariantOpen(false);
  }, [showOptions]);

  useEffect(() => {
    if (!open && !variantOpen && !allowanceOpen) return;
    const close = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setVariantOpen(false);
        setAllowanceOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [allowanceOpen, open, variantOpen]);

  function choose(providerId: string, next: string): void {
    const preserveVariant = providerId === selectedProvider?.id ? selection.variantId : "";
    const provider = providers.find((item) => item.id === providerId);
    onChange(providerId, applyModelVariant(next, preserveVariant, provider?.variants));
    setOpen(false);
    setVariantOpen(false);
    setAllowanceOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function chooseVariant(variantId: string): void {
    if (!selectedProvider) return;
    onChange(selectedProvider.id, applyModelVariant(value, variantId, selectedProvider.variants));
    setVariantOpen(false);
  }

  const allowanceSeverity = providerAllowanceSeverity(allowance);
  const providerMarkClass = [
    "model-provider-mark",
    selectedProvider?.logo ? "logo" : "",
    allowanceSeverity ? `allowance-${allowanceSeverity}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="model-picker" ref={root}>
      {selectedProvider?.mark ? selectedProvider.providesAllowance ? (
        <button
          className={providerMarkClass}
          type="button"
          title={providerAllowanceTitle(selectedProvider.name, allowance)}
          aria-label={`${selectedProvider.name} allowance`}
          aria-expanded={allowanceOpen}
          onClick={() => {
            setOpen(false);
            setVariantOpen(false);
            setAllowanceOpen((current) => !current);
            onAllowance();
          }}
        >
          {selectedProvider.mark}
        </button>
      ) : (
        <span className={providerMarkClass} title={selectedProvider.name} aria-label={selectedProvider.name}>
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
          setAllowanceOpen(false);
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span>{(selection.routable ? selection.baseModelId : value) || placeholder}</span><PickerCaret />
      </button>
      {open ? (
        <FloatingMenu
          anchor={root}
          align="left"
          className={showProviders ? "model-picker-menu with-providers" : "model-picker-menu"}
        >
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
              if (match) choose(match.provider.id, match.value);
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
        </FloatingMenu>
      ) : null}
      {selectedProvider?.providesAllowance && allowanceOpen ? (
        <FloatingMenu anchor={root} align="left" className="provider-allowance-menu">
          <div className="provider-allowance-heading">
            <strong>{selectedProvider.name} allowance</strong>
            <small>Current usage across this connection&apos;s limits.</small>
          </div>
          {allowance === undefined ? <p>Checking allowance…</p> : null}
          {allowance === null ? <p>Allowance is currently unavailable.</p> : null}
          {allowance?.items.map((item) => (
            <AllowanceRow item={item} key={item.label} />
          ))}
        </FloatingMenu>
      ) : null}
      <div className={showOptions ? "model-variant-picker visible" : "model-variant-picker"}>
          <button
            className="model-variant-trigger"
            type="button"
            disabled={disabled || !showOptions}
            title="Model options"
            aria-label={`Model options: ${modelOptionLabel(reasoningEffort, selectedVariant?.label)}`}
            aria-expanded={variantOpen}
            aria-hidden={!showOptions}
            onClick={() => {
              setOpen(false);
              setAllowanceOpen(false);
              setVariantOpen((current) => !current);
            }}
          >
            <span>{modelOptionLabel(reasoningEffort, selectedVariant?.label)}</span><PickerCaret />
          </button>
          {showOptions && variantOpen ? (
            <FloatingMenu anchor={root} align="right" className="model-variant-menu">
              {showReasoning ? (
                <div className="model-option-group">
                  <strong>Reasoning</strong>
                  <button
                    className={reasoningEffort ? "" : "active"}
                    type="button"
                    onClick={() => { onReasoningEffort(""); setVariantOpen(false); }}
                  >
                    <span>Default</span>
                    <small>Use the model or provider default.</small>
                  </button>
                  {selectedModel?.reasoning?.efforts.map((effort) => (
                    <button
                      className={effort === reasoningEffort ? "active" : ""}
                      type="button"
                      key={effort}
                      onClick={() => { onReasoningEffort(effort); setVariantOpen(false); }}
                    >
                      <span>{reasoningLabel(effort)}</span>
                      <small>{reasoningDescription(effort)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {showVariants ? (
                <div className="model-option-group">
                  {showReasoning ? <strong>Routing</strong> : null}
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
            </FloatingMenu>
          ) : null}
      </div>
    </div>
  );
}

function modelOptionLabel(effort: ReasoningEffort | "", variant?: string): string {
  const reasoning = effort ? reasoningLabel(effort) : "";
  const routing = variant && variant !== "Default" ? variant : "";
  return [reasoning, routing].filter(Boolean).join(" · ") || "Default";
}

function reasoningLabel(effort: ReasoningEffort): string {
  if (effort === "none") return "Off";
  if (effort === "xhigh") return "Extra high";
  return `${effort[0]!.toUpperCase()}${effort.slice(1)}`;
}

function reasoningDescription(effort: ReasoningEffort): string {
  if (effort === "none") return "Disable model reasoning for this conversation.";
  return `Use ${reasoningLabel(effort).toLowerCase()} reasoning effort.`;
}

function AllowanceRow({ item }: { item: ProviderAllowanceItem }): JSX.Element {
  const remainingPercent = item.usedPercent === undefined
    ? undefined
    : Math.max(0, Math.round(100 - item.usedPercent));
  const filledSegments = item.usedPercent === undefined
    ? 0
    : Math.round(item.usedPercent / 5);
  const severity = itemAllowanceSeverity(item);
  const reset = item.resetsAt ? formatReset(item.resetsAt) : item.reset;
  return (
    <div className={`provider-allowance-row ${severity}`}>
      <div className="provider-allowance-label">
        <strong>{item.label}</strong>
        <span>{item.remaining ?? (remainingPercent === undefined ? item.used : `${remainingPercent}% left`)}</span>
      </div>
      {item.usedPercent === undefined ? null : (
        <div className="provider-allowance-segments" aria-label={`${item.label}: ${remainingPercent}% left`}>
          {Array.from({ length: 20 }, (_, index) => (
            <span
              className={index < filledSegments ? "used" : ""}
              key={index}
              style={{ animationDelay: `${index * 22}ms` }}
            />
          ))}
        </div>
      )}
      {item.used || reset ? (
        <small>{[item.used, reset].filter(Boolean).join(" · ")}</small>
      ) : null}
    </div>
  );
}

function providerAllowanceSeverity(allowance?: ProviderAllowance | null): "warning" | "critical" | "" {
  const values = allowance?.items.flatMap((item) =>
    item.usedPercent === undefined ? [] : [item.usedPercent]
  ) ?? [];
  const highest = values.length ? Math.max(...values) : 0;
  if (highest >= 96) return "critical";
  if (highest >= 90) return "warning";
  return "";
}

function itemAllowanceSeverity(item: ProviderAllowanceItem): "warning" | "critical" | "" {
  if (item.usedPercent !== undefined && item.usedPercent >= 96) return "critical";
  if (item.usedPercent !== undefined && item.usedPercent >= 90) return "warning";
  return "";
}

function providerAllowanceTitle(name: string, allowance?: ProviderAllowance | null): string {
  if (!allowance?.items.length) return `${name} allowance`;
  const tightest = allowance.items
    .filter((item) => item.usedPercent !== undefined)
    .sort((left, right) => (right.usedPercent ?? 0) - (left.usedPercent ?? 0))[0];
  if (tightest?.usedPercent !== undefined) {
    return `${tightest.label}: ${Math.max(0, Math.round(100 - tightest.usedPercent))}% left`;
  }
  const summary = allowance.items[0]?.remaining ?? allowance.items[0]?.used;
  return summary ? `${name}: ${summary}` : `${name} allowance`;
}

function formatReset(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const milliseconds = date.getTime() - Date.now();
  if (milliseconds > 0 && milliseconds < 48 * 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(milliseconds / 60000));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? `resets in ${hours}h${remainder ? ` ${remainder}m` : ""}` : `resets in ${minutes}m`;
  }
  return `resets ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`;
}

function FloatingMenu({
  anchor,
  align,
  className,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  align: "left" | "right";
  className: string;
  children: ReactNode;
}): JSX.Element | null {
  const [position, setPosition] = useState<{ horizontal: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        horizontal: align === "left" ? rect.left : window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 6,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchor]);

  if (!position) return null;
  return createPortal(
    <div
      className={className}
      style={align === "left"
        ? { left: position.horizontal, bottom: position.bottom }
        : { right: position.horizontal, bottom: position.bottom }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

function PickerCaret(): JSX.Element {
  return (
    <svg className="model-picker-caret" viewBox="0 0 10 10" aria-hidden="true">
      <path d="m1 3 4 4 4-4" />
    </svg>
  );
}
