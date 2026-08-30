import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SidebarContextMenuItem = {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separated?: boolean;
  action(): void;
};

export function SidebarContextMenu({
  top,
  left,
  items,
  onClose,
}: {
  top: number;
  left: number;
  items: SidebarContextMenuItem[];
  onClose(): void;
}): JSX.Element {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top, left });

  useLayoutEffect(() => {
    const bounds = element.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({
      top: Math.max(6, Math.min(top, window.innerHeight - bounds.height - 6)),
      left: Math.max(6, Math.min(left, window.innerWidth - bounds.width - 6)),
    });
  }, [left, top]);

  useEffect(() => {
    function closeOutside(event: PointerEvent): void {
      if (event.target instanceof Node && !element.current?.contains(event.target)) onClose();
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="sidebar-context-menu" ref={element} role="menu" style={position}>
      {items.map((item) => (
        <button
          className={[item.danger ? "danger" : "", item.separated ? "separated" : ""].filter(Boolean).join(" ") || undefined}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          key={item.label}
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
