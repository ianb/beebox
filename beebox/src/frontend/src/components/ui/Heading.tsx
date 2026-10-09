import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface HeadingProps {
  children: ReactNode;
  id?: string;
  /** Outline level. The look follows the level: 2 is a section, 3 a subsection. */
  level: 2 | 3;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Take the text colour from the enclosing card's material. */
  material?: boolean;
}

/** A section heading. Renders a real `h2`/`h3`, so the outline and the look stay in step. */
export function Heading({ children, level, id, className, material }: HeadingProps) {
  const color = material === true ? "text-card-ink" : "text-warm-900";
  if (level === 2) return <h2 id={id} className={cn("text-lg font-semibold", color, className)}>{children}</h2>;
  return <h3 id={id} className={cn("text-sm font-semibold", color, className)}>{children}</h3>;
}
