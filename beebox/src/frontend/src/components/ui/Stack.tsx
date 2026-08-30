import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type StackGap = "none" | "xs" | "sm" | "md" | "lg";
export type StackAs = "div" | "section" | "article" | "ul" | "ol";

export interface StackProps {
  children: ReactNode;
  /** Vertical gap between children. Default `"md"` (0.75rem). */
  gap?: StackGap;
  as?: StackAs;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const GAP_CLASSES: Record<StackGap, string> = {
  none: "",
  xs: "space-y-1",
  sm: "space-y-2",
  md: "space-y-3",
  lg: "space-y-4",
};

export function Stack({ children, gap: gapArg, as: asArg, className }: StackProps) {
  const gap = gapArg ?? "md";
  const as = asArg ?? "div";
  const classes = cn(GAP_CLASSES[gap], className);
  if (as === "section") return <section className={classes}>{children}</section>;
  if (as === "article") return <article className={classes}>{children}</article>;
  if (as === "ul") return <ul className={classes}>{children}</ul>;
  if (as === "ol") return <ol className={classes}>{children}</ol>;
  return <div className={classes}>{children}</div>;
}
