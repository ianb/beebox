/**
 * A landmark's link group as rows: a full-width header (chevron, label, count)
 * that expands into indented children behind a left rule, then "+N more" when
 * the group has members beyond the resolved children. Shared by the app bar's
 * place menu, the chat's landmark links menu, and the Landmarks and place
 * pages; each supplies its own child row.
 */

import { Fragment, useState, type ReactNode } from "react";
import { InlineAction } from "../ui/InlineAction";
import { ChevronIcon } from "./ChevronIcon";

export interface LandmarkGroupRowsProps<Link extends { ref: string }> {
  group: {
    label: string;
    children: Link[];
    /** Total members, which may exceed the resolved `children`. */
    count: number;
  };
  /** One child row. */
  renderChild: (link: Link) => ReactNode;
  /** Start expanded (the place page); menus and the Landmarks page start collapsed. */
  defaultOpen?: boolean;
  /** Makes the "+N more" count an action; plain text without it. */
  onMore?: () => void;
  /** Shown in place of children when the group has no members. */
  emptyText?: string;
  /** Outer-layout classes (font size for a page; menus inherit theirs). */
  className?: string;
}

export function LandmarkGroupRows<Link extends { ref: string }>({
  group,
  renderChild,
  defaultOpen,
  onMore,
  emptyText,
  className,
}: LandmarkGroupRowsProps<Link>) {
  const [open, setOpen] = useState(defaultOpen === true);
  const overflow = group.count - group.children.length;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
      >
        <ChevronIcon open={open} className="shrink-0" />
        <span className="truncate font-medium">{group.label}</span>
        <span className="text-xs text-warm-700 shrink-0 ml-auto">{group.count}</span>
      </button>
      {open ? (
        <div className="border-l border-warm-200 ml-5">
          {group.count === 0 && emptyText !== undefined ? (
            <div className="px-3 py-2 text-warm-700">{emptyText}</div>
          ) : null}
          {group.children.map((link) => (
            <Fragment key={link.ref}>{renderChild(link)}</Fragment>
          ))}
          {overflow > 0 ? (
            <div className="px-3 py-2 text-xs text-warm-700">
              {onMore === undefined ? `+${overflow} more` : (
                <InlineAction intent="subtle" onClick={onMore}>{`+${overflow} more`}</InlineAction>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
