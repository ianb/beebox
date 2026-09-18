import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface HeadingProps {
  children: ReactNode;
  /** Outline level. The look follows the level: 2 is a section, 3 a subsection. */
  level: 2 | 3;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/** A section heading. Renders a real `h2`/`h3`, so the outline and the look stay in step. */
export function Heading({ children, level, className }: HeadingProps) {
  if (level === 2) return <h2 className={cn("text-lg font-semibold text-warm-900", className)}>{children}</h2>;
  return <h3 className={cn("text-sm font-semibold text-warm-900", className)}>{children}</h3>;
}
