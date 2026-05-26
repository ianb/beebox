import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type RowGap = "none" | "xs" | "sm" | "md" | "lg";
export type RowAlign = "start" | "center" | "end" | "baseline" | "stretch";
export type RowJustify = "start" | "center" | "end" | "between" | "around" | "evenly";

export interface RowProps {
  children: ReactNode;
  /** Gap between children. Default `"sm"` (0.5rem). */
  gap?: RowGap;
  /** Cross-axis alignment. Default `"center"`. */
  align?: RowAlign;
  /** Main-axis distribution. Default `"start"`. */
  justify?: RowJustify;
  /** Wrap children onto multiple lines. Default false. */
  wrap?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const GAP_CLASSES: Record<RowGap, string> = {
  none: "",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
};

const ALIGN_CLASSES: Record<RowAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
  stretch: "items-stretch",
};

const JUSTIFY_CLASSES: Record<RowJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

export function Row({
  children,
  gap = "sm",
  align = "center",
  justify = "start",
  wrap = false,
  className,
}: RowProps) {
  const classes = cn(
    "flex",
    GAP_CLASSES[gap],
    ALIGN_CLASSES[align],
    JUSTIFY_CLASSES[justify],
    wrap ? "flex-wrap" : "",
    className,
  );
  return <div className={classes}>{children}</div>;
}
