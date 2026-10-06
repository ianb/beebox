import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface HintProps {
  children: ReactNode;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/** Secondary explanatory text under a heading or control. A block paragraph. */
export function Hint({ children, className }: HintProps) {
  return <p className={cn("text-sm text-warm-500", className)}>{children}</p>;
}
