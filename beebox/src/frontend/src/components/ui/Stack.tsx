import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type StackGap = "none" | "xs" | "sm" | "md" | "lg";
export type StackAs = "div" | "section" | "article" | "ul" | "ol";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackOverflow = "visible" | "hidden" | "auto" | "scroll";

export interface StackProps {
  children: ReactNode;
  /** Vertical gap between children. Default `"md"` (0.75rem). */
  gap?: StackGap;
  as?: StackAs;
  /**
   * Cross-axis (horizontal) alignment. Default `"stretch"`: children fill the
   * width, as blocks do. An inline-level child (a Button, a Badge) that should
   * keep its natural width takes `className="self-start"`.
   */
  align?: StackAlign;
  /** How overflow is handled. Default `"visible"`. */
  overflow?: StackOverflow;
  /**
   * When true, hide on mobile and show as flex at the `sm` breakpoint and
   * above. Common pattern for the detail pane in two-pane page layouts.
   */
  hideOnMobile?: boolean;
  /**
   * Make the stack keyboard-focusable (`tabIndex` 0). Set this on a
   * scrolling stack (`overflow="auto"`): the app is a fixed shell whose
   * window never scrolls, so PageDown/End/arrows only reach a scroll
   * container that can take focus — and a container with focusable children
   * is never keyboard-scrollable by default. (axe: scrollable-region-focusable.)
   */
  focusable?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

// A flex column with gap, not `space-y-*`: margin does nothing to an inline
// child, so a space-y stack of spans rendered as one run-together line.
const GAP_CLASSES: Record<StackGap, string> = {
  none: "",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
};

const ALIGN_CLASSES: Record<StackAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "",
};

// A clipping stack is also a containing block (`relative`): absolutely
// positioned descendants with no positioned ancestor — Tailwind's `sr-only`
// is `position: absolute` — otherwise resolve against the initial containing
// block, and one sitting below the fold inside the scrolled pane STRETCHES
// the document, making the app's fixed shell window-scrollable (found via a
// field-test browse page: a radio card's sr-only input grew the page 43px).
const OVERFLOW_CLASSES: Record<StackOverflow, string> = {
  visible: "",
  hidden: "overflow-hidden relative",
  auto: "overflow-auto relative",
  scroll: "overflow-scroll relative",
};

export function Stack({ children, gap, as, align, overflow, hideOnMobile, focusable, className }: StackProps) {
  gap = gap ?? "md";
  as = as ?? "div";
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
  const props = { className: classes, ...(focusable ? { tabIndex: 0 } : {}) };
  if (as === "section") return <section {...props}>{children}</section>;
  if (as === "article") return <article {...props}>{children}</article>;
  if (as === "ul") return <ul {...props}>{children}</ul>;
  if (as === "ol") return <ol {...props}>{children}</ol>;
  return <div {...props}>{children}</div>;
}
