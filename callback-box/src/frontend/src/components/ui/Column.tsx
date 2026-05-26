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

const OVERFLOW_CLASSES: Record<ColumnOverflow, string> = {
  visible: "",
  hidden: "overflow-hidden",
  auto: "overflow-auto",
  scroll: "overflow-scroll",
};

export function Column({ children, gap = "none", align = "stretch", overflow = "visible", hideOnMobile = false, className }: ColumnProps) {
  const classes = cn(
    "flex flex-col",
    GAP_CLASSES[gap],
    ALIGN_CLASSES[align],
    OVERFLOW_CLASSES[overflow],
    hideOnMobile ? "hidden sm:flex" : "",
    className,
  );
  return <div className={classes}>{children}</div>;
}
