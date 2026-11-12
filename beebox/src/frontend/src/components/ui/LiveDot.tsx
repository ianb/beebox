import { cn } from "../../lib/cn";

export type LiveDotTone = "danger" | "warning" | "info" | "accent" | "current";
export type LiveDotSize = "sm" | "md";

export interface LiveDotProps {
  /** Color: a status tone, or `current` to take the surrounding text color. Default `current`. */
  tone?: LiveDotTone;
  /** `sm` is 6px (a chip too narrow for words); `md` (default) is 8px. */
  size?: LiveDotSize;
  /** Outer-layout classes (margin, alignment). */
  className?: string;
}

const TONE_CLASSES: Record<LiveDotTone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
  accent: "bg-accent",
  current: "bg-current",
};
const SIZE_CLASSES: Record<LiveDotSize, string> = { sm: "w-1.5 h-1.5", md: "w-2 h-2" };

/**
 * A pulsing dot: something is live, recording, or still working. Decorative
 * (`aria-hidden`): the same fact is stated in adjacent text or a label. Under
 * `prefers-reduced-motion` it pulses once and rests solid (the global rule in
 * `index.css`).
 */
export function LiveDot({ tone, size, className }: LiveDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full animate-pulse",
        SIZE_CLASSES[size ?? "md"],
        TONE_CLASSES[tone ?? "current"],
        className,
      )}
    />
  );
}
