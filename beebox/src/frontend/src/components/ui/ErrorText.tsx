import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ErrorTextProps {
  children: ReactNode;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/**
 * An error message. A block paragraph in the danger color. It is not a live
 * region: a component that shows a new error after a user action owns any
 * announcement.
 */
export function ErrorText({ children, className }: ErrorTextProps) {
  return <p className={cn("text-sm text-danger-dark", className)}>{children}</p>;
}
