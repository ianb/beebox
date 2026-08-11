import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ColumnGap = "none" | "xs" | "sm" | "md" | "lg";
export type ColumnAlign = "start" | "center" | "end" | "stretch";
export type ColumnOverflow = "visible" | "hidden" | "auto" | "scroll";

export interface ColumnProps {
  children: ReactNode;
  /** Gap between children. Default `"none"`. */
  gap?: ColumnGap;
  /** Cross-axis alignment (horizontal in a column). Default `"stretch"`. */
  align?: ColumnAlign;
  /** How overflow is handled. Default `"visible"`. */
  overflow?: ColumnOverflow;
  /**
   * When true, hide on mobile and show as flex at the `sm` breakpoint and
   * above. Common pattern for the detail pane in two-pane page layouts.
   */
  hideOnMobile?: boolean;
  /**
   * Make the column keyboard-focusable (`tabIndex` 0). Set this on a
   * scrolling column (`overflow="auto"`): the app is a fixed shell whose
   * window never scrolls, so PageDown/End/arrows only reach a scroll
   * container that can take focus — and a container with focusable children
   * is never keyboard-scrollable by default. (axe: scrollable-region-focusable.)
   */
  focusable?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const GAP_CLASSES: Record<ColumnGap, string> = {
  none: "",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
};

const ALIGN_CLASSES: Record<ColumnAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

// A clipping column is also a containing block (`relative`): absolutely
// positioned descendants with no positioned ancestor — Tailwind's `sr-only`
// is `position: absolute` — otherwise resolve against the initial containing
// block, and one sitting below the fold inside the scrolled pane STRETCHES
// the document, making the app's fixed shell window-scrollable (found via a
// field-test browse page: a radio card's sr-only input grew the page 43px).
const OVERFLOW_CLASSES: Record<ColumnOverflow, string> = {
  visible: "",
  hidden: "overflow-hidden relative",
  auto: "overflow-auto relative",
  scroll: "overflow-scroll relative",
};

export function Column({ children, gap, align, overflow, hideOnMobile, focusable, className }: ColumnProps) {
  gap = gap ?? "none";
  align = align ?? "stretch";
  overflow = overflow ?? "visible";
  hideOnMobile = hideOnMobile ?? false;
  focusable = focusable ?? false;
  const classes = cn(
    "flex flex-col",
    GAP_CLASSES[gap],
    ALIGN_CLASSES[align],
    OVERFLOW_CLASSES[overflow],
    hideOnMobile ? "hidden sm:flex" : "",
    focusable ? "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" : "",
    className,
  );
  return <div className={classes} {...(focusable ? { tabIndex: 0 } : {})}>{children}</div>;
}
