import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  title?: string;
  /** Take the neutral tone from the enclosing card's material (`card-tint` chip, `card-soft` text). Other tones keep their meaning colours. */
  material?: boolean;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-warm-100 text-warm-500",
  info: "bg-info-50 text-info-dark",
  success: "bg-success-100 text-success-dark",
  warning: "bg-accent-100 text-accent-dark",
  danger: "bg-danger-100 text-danger",
  accent: "bg-primary-50 text-primary-dark",
};

const MATERIAL_NEUTRAL_CLASSES = "bg-card-tint text-card-soft";

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
};

export function Badge({ children, tone, size, className, title, material }: BadgeProps) {
  tone = tone ?? "neutral";
  size = size ?? "md";
  const classes = cn(
    "inline-block rounded font-medium",
    material === true && tone === "neutral" ? MATERIAL_NEUTRAL_CLASSES : TONE_CLASSES[tone],
    SIZE_CLASSES[size],
    className,
  );
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
