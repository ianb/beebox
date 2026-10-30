import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMaterial } from "./material";

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
  /** Muted color (text-warm-700, or `card-soft` on a material) — for secondary output. */
  muted?: boolean;
  /**
   * Take the ink from the nearest material (`card-ink`/`card-soft`) instead of
   * the app palette. Defaults to the nearest material's. A `boxed` plate is an
   * app surface of its own, so it keeps app ink on any material.
   */
  material?: boolean;
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
  size,
  boxed,
  scroll,
  error,
  muted,
  title,
  className,
  material,
}: PreProps) {
  material = useMaterial(material);
  size = size ?? "sm";
  boxed = boxed ?? false;
  scroll = scroll ?? false;
  error = error ?? false;
  muted = muted ?? false;
  const onMaterial = material && !boxed;
  const colorClass = error
    ? "text-danger-dark"
    : onMaterial
      ? muted ? "text-card-soft" : "text-card-ink"
      : muted ? "text-warm-700" : "text-warm-800";
  const boxClass = boxed
    ? error
      ? "bg-danger-50 border border-danger-100 rounded p-3"
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
