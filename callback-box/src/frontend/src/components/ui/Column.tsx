import type { ReactNode } from "react";

export type ColumnGap = "none" | "xs" | "sm" | "md" | "lg";
export type ColumnAlign = "start" | "center" | "end" | "stretch";

export interface ColumnProps {
  children: ReactNode;
  /** Gap between children. Default `"none"`. */
  gap?: ColumnGap;
  /** Cross-axis alignment (horizontal in a column). Default `"stretch"`. */
  align?: ColumnAlign;
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

export function Column({ children, gap = "none", align = "stretch", className }: ColumnProps) {
  const classes = ["flex flex-col", GAP_CLASSES[gap], ALIGN_CLASSES[align], className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}
