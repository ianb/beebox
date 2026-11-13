import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ListMarker = "none" | "disc" | "decimal";
export type ListGap = "none" | "xs" | "sm" | "md";
export type ListDirection = "column" | "row" | "wrap";

interface ListBaseProps {
  /** Raw `<li>` elements. */
  children: ReactNode;
  /**
   * `none` (default) has no bullet and keeps the list role (`role="list"`:
   * Safari drops it under `list-style: none`). `disc` and `decimal` render
   * `<ul>` and `<ol>` with an outside, muted marker.
   */
  marker?: ListMarker;
  /** Ordered content without numbers (`<ol>` with `marker="none"`): steps, ranked windows, breadcrumbs. */
  ordered?: boolean;
  /** `column` (default) stacks items; `row` lays them in one line; `wrap` lets that line wrap. */
  direction?: ListDirection;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  [data: `data-${string}`]: string | undefined;
  /** Outer-layout classes; inside components/, also the list's text size and color. */
  className?: string;
}

/**
 * Items are separated by `gap`, or by `divided`: a rule between items with
 * padding on both sides of it. The two do not combine.
 */
export type ListProps = ListBaseProps & (
  | { gap?: ListGap; divided?: false }
  | { divided: true; gap?: never }
);

const GAP_CLASSES: Record<ListGap, string> = {
  none: "",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
};

const DIRECTION_CLASSES: Record<ListDirection, string> = {
  column: "flex flex-col",
  row: "flex flex-row",
  wrap: "flex flex-row flex-wrap",
};

const MARKER_CLASSES: Record<ListMarker, string> = {
  none: "",
  disc: "list-disc list-outside pl-5 marker:text-warm-400",
  decimal: "list-decimal list-outside pl-5 marker:text-warm-400",
};

const DIVIDED = "divide-y divide-warm-200 [&>li]:py-2 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0";

/** A `<ul>` or `<ol>` of raw `<li>` children: the one list element outside Markdown. */
export function List({ children, marker, ordered, direction, gap, divided, className, ...rest }: ListProps) {
  marker = marker ?? "none";
  const classes = cn(
    DIRECTION_CLASSES[direction ?? "column"],
    divided === true ? DIVIDED : GAP_CLASSES[gap ?? "none"],
    MARKER_CLASSES[marker],
    className,
  );
  const role = marker === "none" ? "list" : undefined;
  if (marker === "decimal" || ordered === true) return <ol role={role} className={classes} {...rest}>{children}</ol>;
  return <ul role={role} className={classes} {...rest}>{children}</ul>;
}
