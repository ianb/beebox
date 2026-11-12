/**
 * `MenuItem`/`MenuDivider` — the row primitives for `Menu`'s children,
 * split out of Menu.tsx to keep that file under the 300-line cap. Reads
 * `MenuContext` (exported by Menu.tsx) for close-on-click and dense
 * spacing.
 */

import { useContext, type ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "../../lib/cn";
import { href } from "../../lib/routing";
import { MenuContext, useMenuItemRole } from "./Menu";

interface MenuItemBase {
  children: ReactNode;
  /** Stable `bbx-` control address for the rendered row (see lib/ui-scan). */
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
  /** Tooltip text for the row. */
  title?: string;
  /**
   * A second item beside the row (the model pin): its own `menuitem`
   * button, reached by the arrow keys as the next item. It never selects the
   * row; `keepOpen` leaves the menu open after it.
   */
  action?: MenuItemAction;
  /** `data-*` attributes for the row (`bbxSource`). */
  [data: `data-${string}`]: string | undefined;
}

export interface MenuItemAction {
  /** Accessible name and tooltip of the icon button. */
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  keepOpen?: boolean;
}

/** A router link row: the TanStack `Link` props the menus use. */
interface MenuItemLink {
  to: string;
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  hash?: LinkProps["hash"];
  state?: LinkProps["state"];
  onClick?: never;
  href?: never;
}

export type MenuItemProps = MenuItemBase & (
  | { onClick: () => void | Promise<void>; to?: never; href?: never }
  | MenuItemLink
  | { href: string; target?: "_blank"; download?: string; onClick?: never; to?: never }
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

function dataAttributes(props: MenuItemProps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-") && typeof value === "string") out[key] = value;
  }
  return out;
}

export function MenuItem(props: MenuItemProps) {
  const ctx = useContext(MenuContext);
  const role = useMenuItemRole();
  const close = ctx !== null ? ctx.close : noop;
  const row = <MenuItemRow props={props} role={role} close={close} dense={ctx !== null ? ctx.dense : false} />;
  const { action } = props;
  if (action === undefined) return row;
  const wrapperRole = role === undefined ? undefined : "none";
  return (
    <div role={wrapperRole} className="flex items-stretch">
      <div role={wrapperRole} className="flex-1 min-w-0">{row}</div>
      <button
        type="button"
        role={role}
        aria-label={action.label}
        title={action.label}
        onClick={() => {
          if (action.keepOpen !== true) close();
          action.onSelect();
        }}
        className="px-2 text-warm-400 hover:text-warm-700 hover:bg-warm-50 transition-colors"
      >
        <span aria-hidden="true">{action.icon}</span>
      </button>
    </div>
  );
}

function MenuItemRow({ props, role, close, dense }: { props: MenuItemProps; role: "menuitem" | undefined; close: () => void; dense: boolean }) {
  const { children, id, icon, title, disabled = false, danger = false, active = false, keepOpen = false } = props;
  const className = rowClass({ active, danger, disabled, dense });
  const content = <MenuItemContent icon={icon}>{children}</MenuItemContent>;
  const data = dataAttributes(props);
  const closeUnlessKept = () => { if (!keepOpen) close(); };

  if ((props.to !== undefined || props.href !== undefined) && disabled) {
    return <span id={id} role={role} aria-disabled="true" title={title} {...data} className={className}>{content}</span>;
  }

  if (props.to !== undefined) {
    return (
      <Link id={id} role={role} to={href(props.to)} params={props.params} search={props.search} hash={props.hash} state={props.state} title={title} {...data} onClick={closeUnlessKept} className={className}>
        {content}
      </Link>
    );
  }

  if (props.href !== undefined) {
    return (
      <a id={id} role={role} href={props.href} target={props.target} rel={props.target ? "noopener noreferrer" : undefined} download={props.download} title={title} {...data} onClick={closeUnlessKept} className={className}>
        {content}
      </a>
    );
  }

  const onClick = props.onClick;
  return (
    <button
      id={id}
      type="button"
      role={role}
      disabled={disabled}
      title={title}
      {...data}
      onClick={() => {
        if (disabled) return;
        closeUnlessKept();
        // Safety net for this shared primitive: individual callers are
        // expected to surface their own user-visible errors; this is the
        // last-resort log if an onClick's promise rejects uncaught.
        void Promise.resolve(onClick()).catch((err: unknown) => {
          console.error("[Menu] MenuItem onClick handler threw:", err);
        });
      }}
      className={className}
    >
      {content}
    </button>
  );
}

export function MenuDivider() {
  const ctx = useContext(MenuContext);
  const dense = ctx !== null ? ctx.dense : false;
  return <div className={cn("border-t border-warm-100", dense ? "my-0.5" : "my-1")} role="separator" />;
}
