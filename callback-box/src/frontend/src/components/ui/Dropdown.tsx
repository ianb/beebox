import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/cn";

interface DropdownContextValue {
  close: () => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

export type DropdownAlign = "left" | "right";

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
  /** Tailwind width class for the menu. Default `"w-48"`. */
  width?: string;
  /** Outer-layout classes for the relative-positioned wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
}

export function Dropdown({ trigger, children, align = "right", width = "w-48", className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const alignClass = align === "right" ? "right-0" : "left-0";
  const ctxValue = useMemo<DropdownContextValue>(() => ({ close: () => setOpen(false) }), []);
  const triggerProps: DropdownTriggerProps = {
    open,
    toggle: () => setOpen((o) => !o),
    ariaProps: { "aria-haspopup": "menu", "aria-expanded": open },
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {trigger(triggerProps)}
      {open ? (
        <div
          role="menu"
          className={cn("absolute top-full mt-1 bg-white rounded-lg shadow-lg border border-warm-200 py-1 z-50 text-sm", alignClass, width)}
        >
          <DropdownContext.Provider value={ctxValue}>
            {children}
          </DropdownContext.Provider>
        </div>
      ) : null}
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
}

function rowClass({ active, danger, disabled }: RowClassOpts): string {
  if (disabled) {
    return "block w-full text-left px-3 py-2 text-warm-400 cursor-not-allowed";
  }
  if (active) {
    return "block w-full text-left px-3 py-2 bg-warm-100 text-warm-900 font-medium";
  }
  const color = danger ? "text-danger hover:bg-danger/10" : "text-warm-700 hover:bg-warm-50";
  return `block w-full text-left px-3 py-2 transition-colors ${color}`;
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
  const { children, icon, disabled = false, danger = false, active = false } = props;
  const className = rowClass({ active, danger, disabled });
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
        close();
        await onClick();
      }}
      className={className}
    >
      {content}
    </button>
  );
}

export function MenuDivider() {
  return <div className="border-t border-warm-100 my-1" role="separator" />;
}
