import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface StatusMessageProps {
  children: ReactNode;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). Default padding is `p-8`. */
  className?: string;
}

/**
 * A pane's placeholder while it has nothing to show: loading, empty, or not
 * found. `role="status"` lets screen readers announce it. Errors use
 * `ErrorText`.
 */
export function StatusMessage({ children, className }: StatusMessageProps) {
  return <div role="status" className={cn("p-8 text-warm-600", className)}>{children}</div>;
}
