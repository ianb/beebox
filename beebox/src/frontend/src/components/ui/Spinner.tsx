import { cn } from "../../lib/cn";

export type SpinnerSize = "sm" | "md";
export type SpinnerTone = "current" | "onDark";

export interface SpinnerProps {
  /** `sm` (1rem, the default) sits in a line of text or a button; `md` (1.25rem) fills a thumbnail or an icon button. */
  size?: SpinnerSize;
  /** `current` (default) takes the surrounding text color; `onDark` is white, for a dark or colored backdrop. */
  tone?: SpinnerTone;
  /** Outer-layout classes (margin, flex item, position). */
  className?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = { sm: "w-4 h-4", md: "w-5 h-5" };
const TONE_CLASSES: Record<SpinnerTone, string> = { current: "", onDark: "text-white" };

/**
 * An indeterminate progress glyph: work continues and its end is not known.
 * Decorative (`aria-hidden`): the caller names the work in text, `aria-busy`
 * or a label. Under `prefers-reduced-motion` it keeps turning at a third of
 * its speed (`.bbx-spinner` in `index.css`), since a spinner that stops reads
 * as stalled work.
 */
export function Spinner({ size, tone, className }: SpinnerProps) {
  return (
    <svg
      className={cn(
        "bbx-spinner animate-spin shrink-0",
        SIZE_CLASSES[size ?? "sm"],
        TONE_CLASSES[tone ?? "current"],
        className,
      )}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
