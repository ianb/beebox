import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type PreSize = "xs" | "sm" | "base";
export type PreScroll = "sm" | "md" | "lg" | false;

export interface PreProps {
  children: ReactNode;
  /** Text size. Default `"sm"`. */
  size?: PreSize;
  /** When true, renders as a standalone block with background + padding + rounded corners. */
  boxed?: boolean;
  /** Enable scrolling with a max height. Default `false` (no scroll). */
  scroll?: PreScroll;
  /** Red error coloring. When `boxed`, also applies a red-tinted background. */
  error?: boolean;
  /** Muted color (text-warm-500) — for secondary output. */
  muted?: boolean;
  title?: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const SIZE_CLASSES: Record<PreSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

const SCROLL_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "max-h-40 overflow-auto",
  md: "max-h-64 overflow-auto",
  lg: "max-h-96 overflow-auto",
};

export function Pre({
  children,
  size = "sm",
  boxed = false,
  scroll = false,
  error = false,
  muted = false,
  title,
  className,
}: PreProps) {
  const colorClass = error ? "text-red-700" : muted ? "text-warm-500" : "text-warm-800";
  const boxClass = boxed
    ? error
      ? "bg-red-50 border border-red-200 rounded p-3"
      : "bg-warm-50 rounded p-3"
    : "";
  const scrollClass = scroll !== false ? SCROLL_CLASSES[scroll] : "";
  const classes = cn(
    "font-mono whitespace-pre-wrap break-words",
    SIZE_CLASSES[size],
    colorClass,
    boxClass,
    scrollClass,
    className,
  );
  return (
    <pre className={classes} title={title}>
      {children}
    </pre>
  );
}
