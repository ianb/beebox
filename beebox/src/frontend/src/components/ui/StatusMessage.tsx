import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type StatusMessageVariant = "pane" | "menu";

export interface StatusMessageProps {
  children: ReactNode;
  /**
   * `pane` (default) is a roomy `p-8` placeholder for a whole pane. `menu` is
   * a compact small-text row inside a dropdown or list panel.
   */
  variant?: StatusMessageVariant;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const VARIANT_CLASSES: Record<StatusMessageVariant, string> = {
  pane: "p-8 text-warm-700",
  menu: "px-3 py-2 text-sm text-warm-700",
};

/**
 * A placeholder while there is nothing to show: loading, empty, or not
 * found. `role="status"` lets screen readers announce it. Errors use
 * `ErrorText`.
 */
export function StatusMessage({ children, variant, className }: StatusMessageProps) {
  return <div role="status" className={cn(VARIANT_CLASSES[variant ?? "pane"], className)}>{children}</div>;
}
