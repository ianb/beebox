import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMaterial } from "./material";

export interface ErrorTextProps {
  children: ReactNode;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Take the red from the enclosing card's material (`card-danger`, set per theme). Defaults to the nearest Card's. */
  material?: boolean;
}

/**
 * An error message. A block paragraph in the danger color. It is not a live
 * region: a component that shows a new error after a user action owns any
 * announcement. On a card's material it takes the theme's own red, which
 * each theme keeps readable on its paper.
 */
export function ErrorText({ children, className, material }: ErrorTextProps) {
  return <p className={cn("text-sm", useMaterial(material) ? "text-card-danger" : "text-danger-dark", className)}>{children}</p>;
}
