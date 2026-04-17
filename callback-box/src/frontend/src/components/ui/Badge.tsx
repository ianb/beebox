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
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-warm-100 text-warm-500",
  info: "bg-iris-50 text-iris-dark",
  success: "bg-green-100 text-green-800",
  warning: "bg-gold-100 text-gold-dark",
  danger: "bg-rose-100 text-rose",
  accent: "bg-plum-50 text-plum-dark",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
};

export function Badge({ children, tone = "neutral", size = "md", className, title }: BadgeProps) {
  const classes = cn(
    "inline-block rounded font-medium",
    TONE_CLASSES[tone],
    SIZE_CLASSES[size],
    className,
  );
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
