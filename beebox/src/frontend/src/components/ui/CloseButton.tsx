import { cn } from "../../lib/cn";

export type CloseButtonSize = "sm" | "md";
export type CloseButtonVariant = "plain" | "bubble";

export interface CloseButtonProps {
  onClick: () => void;
  /** DOM id. Set it to publish a `bbx-` control address (docs/plans/agent-points-at-ui.md). */
  id?: string;
  /** Accessible label. Default `"Close"`. Override for specifics ("Dismiss error", "Close preview"). */
  label?: string;
  size?: CloseButtonSize;
  /**
   * `plain` (default) is a round ghost button. `bubble` is a 20 px red circle
   * with a white ×, for the corner of an attachment chip; position it with
   * `className` and ignore `size` and `onDark`.
   */
  variant?: CloseButtonVariant;
  /**
   * When true, renders a white-pill variant that stays visible on dark backgrounds
   * (image/video overlays, dark-colored bars). Use on any backdrop where a ghost
   * icon would be hard to see.
   */
  onDark?: boolean;
  /**
   * When true, the × takes the surrounding text colour, for a bar each system
   * theme inks itself (the chat composer). Ignored with `onDark`.
   */
  ink?: boolean;
  disabled?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const SIZE_CLASSES: Record<CloseButtonSize, string> = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
};

function XIcon({ size }: { size: CloseButtonSize }) {
  const dim = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <svg className={dim} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

export function CloseButton({ onClick, id, label, size, variant, onDark, ink, disabled, className }: CloseButtonProps) {
  label = label ?? "Close";
  if (variant === "bubble") {
    return (
      <button
        type="button"
        id={id}
        onClick={onClick}
        disabled={disabled ?? false}
        aria-label={label}
        title={label}
        className={cn(
          "w-5 h-5 rounded-full bg-danger text-white inline-flex items-center justify-center shadow hover:bg-danger-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    );
  }
  size = size ?? "md";
  onDark = onDark ?? false;
  disabled = disabled ?? false;
  const colorClass = onDark
    ? "bg-white/90 hover:bg-white text-warm-700 shadow"
    : ink === true
      ? "bg-transparent text-current opacity-75 hover:opacity-100"
      : "bg-transparent hover:bg-warm-100 text-warm-600 hover:text-warm-700";
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        SIZE_CLASSES[size],
        colorClass,
        "rounded-full inline-flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
    >
      <XIcon size={size} />
    </button>
  );
}
