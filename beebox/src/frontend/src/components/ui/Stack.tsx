import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type StackGap = "none" | "xs" | "sm" | "md" | "lg";
export type StackAs = "div" | "section" | "article" | "ul" | "ol";

export interface StackProps {
  children: ReactNode;
  /**
   * Vertical gap between children. Default `"md"` (0.75rem). Children stretch
   * to the full width, as blocks do; an inline-level child (a Button, a Badge)
   * that should keep its natural width takes `className="self-start"`.
   */
  gap?: StackGap;
  as?: StackAs;
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

export function Stack({ children, gap: gapArg, as: asArg, className }: StackProps) {
  const gap = gapArg ?? "md";
  const as = asArg ?? "div";
  const classes = cn("flex flex-col", GAP_CLASSES[gap], className);
  if (as === "section") return <section className={classes}>{children}</section>;
  if (as === "article") return <article className={classes}>{children}</article>;
  if (as === "ul") return <ul className={classes}>{children}</ul>;
  if (as === "ol") return <ol className={classes}>{children}</ol>;
  return <div className={classes}>{children}</div>;
}
