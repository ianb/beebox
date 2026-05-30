import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/cn";

interface DropdownContextValue {
  close: () => void;
  /** Tighter padding for menu items + dividers. */
  dense: boolean;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

/** Close the enclosing Dropdown. No-op outside one. For custom menu content. */
export function useDropdownClose(): () => void {
  const ctx = useContext(DropdownContext);
  return ctx !== null ? ctx.close : () => {};
}

export type DropdownAlign = "left" | "right";
export type DropdownVertical = "below" | "above";

export interface DropdownTriggerProps {
  open: boolean;
  toggle: () => void;
  /** Props to spread on your trigger element for correct ARIA. */
  ariaProps: { "aria-haspopup": "menu"; "aria-expanded": boolean };
}

export interface DropdownProps {
  /**
   * Render prop that produces the trigger. Wire `toggle` into your
   * element's `onClick` and spread `ariaProps` for accessibility.
   */
  trigger: (props: DropdownTriggerProps) => ReactNode;
  children: ReactNode;
  /** Menu edge aligned to the trigger. Default `"right"`. */
  align?: DropdownAlign;
  /** Whether the menu opens below or above the trigger. Default `"below"`. */
  vertical?: DropdownVertical;
  /** Tailwind width class for the menu. Default `"w-48"`. */
  width?: string;
  /** Tighter padding for menu items + dividers. */
  dense?: boolean;
  /** Outer-layout classes for the relative-positioned wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Called whenever the menu transitions from open to closed. Use to reset
   *  per-open ephemeral state (e.g. submenu page). */
  onClose?: () => void;
}

export function Dropdown({ trigger, children, align: alignArg, vertical: verticalArg, width: widthArg, dense: denseArg, className, onClose }: DropdownProps) {
  const align = alignArg ?? "right";
  const vertical = verticalArg ?? "below";
  const width = widthArg ?? "w-48";
  const dense = denseArg ?? false;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  // Fire onClose on the open→closed transition.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      const cb = onCloseRef.current;
      if (cb) cb();
    }
    prevOpenRef.current = open;
  }, [open]);

  // The menu is portaled to document.body so it escapes any `overflow-hidden`
  // / clipping ancestor (e.g. chat message bubbles). Because it's no longer in
  // normal flow, it's positioned `fixed` from the trigger's viewport rect and
  // repositioned on scroll/resize.
  const [coords, setCoords] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || rootRef.current === null) return;
    const update = () => {
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const gap = 4;
      const next: CSSProperties = { position: "fixed" };
      if (vertical === "above") next.bottom = window.innerHeight - rect.top + gap;
      else next.top = rect.bottom + gap;
      if (align === "right") next.right = window.innerWidth - rect.right;
      else next.left = rect.left;
      setCoords(next);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, align, vertical]);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      const target = e.target as Node;
      const inRoot = rootRef.current !== null && rootRef.current.contains(target);
      const inMenu = menuRef.current !== null && menuRef.current.contains(target);
      if (!inRoot && !inMenu) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const ctxValue = useMemo<DropdownContextValue>(() => ({ close: () => setOpen(false), dense }), [dense]);
  const triggerProps: DropdownTriggerProps = {
    open,
    toggle: () => setOpen((o) => !o),
    ariaProps: { "aria-haspopup": "menu", "aria-expanded": open },
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {trigger(triggerProps)}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={coords}
              className={cn("bg-white rounded-lg shadow-lg border border-warm-200 z-[100] text-sm", dense ? "py-0.5" : "py-1", width)}
            >
              <DropdownContext.Provider value={ctxValue}>
                {children}
              </DropdownContext.Provider>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ---------- MenuItem ----------

interface MenuItemBase {
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Styles as a destructive row. */
  danger?: boolean;
  /** Highlights the row as the current selection. */
  active?: boolean;
  /**
   * Don't close the dropdown on click. Use for items that open a nested
   * panel inside the same menu (e.g. submenu swap pattern).
   */
  keepOpen?: boolean;
}

export type MenuItemProps = MenuItemBase & (
  | { onClick: () => void | Promise<void>; to?: never; href?: never }
  | { to: string; onClick?: never; href?: never }
  | { href: string; onClick?: never; to?: never }
);

interface RowClassOpts {
  active: boolean;
  danger: boolean;
  disabled: boolean;
  dense: boolean;
}

function rowClass({ active, danger, disabled, dense }: RowClassOpts): string {
  const pad = dense ? "px-3 py-1" : "px-3 py-2";
  if (disabled) {
    return `block w-full text-left ${pad} text-warm-400 cursor-not-allowed`;
  }
  if (active) {
    return `block w-full text-left ${pad} bg-warm-100 text-warm-900 font-medium`;
  }
  const color = danger ? "text-danger hover:bg-danger/10" : "text-warm-700 hover:bg-warm-50";
  return `block w-full text-left ${pad} transition-colors ${color}`;
}

function MenuItemContent({ icon, children }: { icon: ReactNode | undefined; children: ReactNode }) {
  if (icon === undefined) return children;
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

function noop() {}

export function MenuItem(props: MenuItemProps) {
  const ctx = useContext(DropdownContext);
  const close = ctx !== null ? ctx.close : noop;
  const dense = ctx !== null ? ctx.dense : false;
  const { children, icon, disabled = false, danger = false, active = false, keepOpen = false } = props;
  const className = rowClass({ active, danger, disabled, dense });
  const content = <MenuItemContent icon={icon}>{children}</MenuItemContent>;

  if ("to" in props && props.to !== undefined) {
    if (disabled) {
      return <span role="menuitem" aria-disabled="true" className={className}>{content}</span>;
    }
    return (
      <Link role="menuitem" to={props.to} onClick={close} className={className}>
        {content}
      </Link>
    );
  }

  if ("href" in props && props.href !== undefined) {
    if (disabled) {
      return <span role="menuitem" aria-disabled="true" className={className}>{content}</span>;
    }
    return (
      <a role="menuitem" href={props.href} onClick={close} className={className}>
        {content}
      </a>
    );
  }

  const onClick = "onClick" in props ? props.onClick : undefined;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={async () => {
        if (disabled || onClick === undefined) return;
        if (!keepOpen) close();
        await onClick();
      }}
      className={className}
    >
      {content}
    </button>
  );
}

export function MenuDivider() {
  const ctx = useContext(DropdownContext);
  const dense = ctx !== null ? ctx.dense : false;
  return <div className={cn("border-t border-warm-100", dense ? "my-0.5" : "my-1")} role="separator" />;
}
