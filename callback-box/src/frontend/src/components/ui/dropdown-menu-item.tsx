/**
 * `MenuItem`/`MenuDivider` — the row primitives for `Dropdown`'s children,
 * split out of Dropdown.tsx to keep that file under the 300-line cap. Reads
 * `DropdownContext` (exported by Dropdown.tsx) for close-on-click and dense
 * spacing.
 */

import { useContext, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/cn";
import { DropdownContext } from "./Dropdown";

interface MenuItemBase {
  children: ReactNode;
  /** Stable `cb-` control address for the rendered row (see lib/ui-scan). */
  id?: string;
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
  const { children, id, icon, disabled = false, danger = false, active = false, keepOpen = false } = props;
  const className = rowClass({ active, danger, disabled, dense });
  const content = <MenuItemContent icon={icon}>{children}</MenuItemContent>;

  if ("to" in props && props.to !== undefined) {
    if (disabled) {
      return <span id={id} role="menuitem" aria-disabled="true" className={className}>{content}</span>;
    }
    return (
      <Link id={id} role="menuitem" to={props.to} onClick={close} className={className}>
        {content}
      </Link>
    );
  }

  if ("href" in props && props.href !== undefined) {
    if (disabled) {
      return <span id={id} role="menuitem" aria-disabled="true" className={className}>{content}</span>;
    }
    return (
      <a id={id} role="menuitem" href={props.href} onClick={close} className={className}>
        {content}
      </a>
    );
  }

  const onClick = "onClick" in props ? props.onClick : undefined;
  return (
    <button
      id={id}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled || onClick === undefined) return;
        if (!keepOpen) close();
        // Safety net for this shared primitive: individual callers are
        // expected to surface their own user-visible errors; this is the
        // last-resort log if an onClick's promise rejects uncaught.
        void Promise.resolve(onClick()).catch((err: unknown) => {
          console.error("[Dropdown] MenuItem onClick handler threw:", err);
        });
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
