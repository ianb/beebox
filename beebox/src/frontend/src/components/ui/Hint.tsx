import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMaterial } from "./material";

export interface HintProps {
  children: ReactNode;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Take the colour from the enclosing card's material. Defaults to the nearest Card's. */
  material?: boolean;
}

/** Secondary explanatory text under a heading or control. A block paragraph. */
export function Hint({ children, className, material }: HintProps) {
  return <p className={cn("text-sm", useMaterial(material) ? "text-card-soft" : "text-warm-700", className)}>{children}</p>;
}
