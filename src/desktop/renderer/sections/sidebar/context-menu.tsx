import { useEffect, useRef } from "react";

export type SidebarContextMenuItem = {
  label: string;
  disabled?: boolean;
  danger?: boolean;
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

  return (
    <div className="sidebar-context-menu" ref={element} role="menu" style={{ top, left }}>
      {items.map((item) => (
        <button
          className={item.danger ? "danger" : undefined}
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
    </div>
  );
}
