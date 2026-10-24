/**
 * A landmark's link group as rows: a full-width header (chevron, label, count)
 * that expands into indented children behind a left rule, then "+N more" when
 * the group has members beyond the resolved children. Shared by the app bar's
 * place menu, the chat's landmark links menu, and the Landmarks and place
 * pages; each supplies its own child row.
 */

import { Fragment, useState, type ReactNode } from "react";
import { InlineAction } from "../ui/InlineAction";
import { useMaterial } from "../ui/material";
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

/**
 * Row colours: app ink in a menu or white panel, the card's ink when the
 * rows sit on a material (the place page, on the card itself).
 */
export function useLandmarkRowInk(): { head: string; ink: string; soft: string; alert: string; hover: string; rule: string } {
  // App red is too faint on a dark card; there the word itself carries it.
  return useMaterial(undefined)
    ? { head: "text-card-ink", ink: "text-card-ink", soft: "text-card-soft", alert: "text-card-ink", hover: "hover:bg-card-tint", rule: "border-card-rule" }
    : { head: "text-warm-800", ink: "text-warm-900", soft: "text-warm-700", alert: "text-danger", hover: "hover:bg-warm-100", rule: "border-warm-200" };
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
  const { head, soft, hover, rule } = useLandmarkRowInk();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full text-left px-3 py-2 ${hover} flex items-center gap-2 ${head}`}
      >
        <ChevronIcon open={open} className="shrink-0" />
        <span className="truncate font-medium">{group.label}</span>
        <span className={`text-xs ${soft} shrink-0 ml-auto`}>{group.count}</span>
      </button>
      {open ? (
        <div className={`border-l ${rule} ml-5`}>
          {group.count === 0 && emptyText !== undefined ? (
            <div className={`px-3 py-2 ${soft}`}>{emptyText}</div>
          ) : null}
          {group.children.map((link) => (
            <Fragment key={link.ref}>{renderChild(link)}</Fragment>
          ))}
          {overflow > 0 ? (
            <div className={`px-3 py-2 text-xs ${soft}`}>
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
