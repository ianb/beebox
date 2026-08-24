import { cn } from "../../lib/cn";

export type ExternalIconLinkSize = "sm" | "md";

export interface ExternalIconLinkProps {
  href: string;
  /** Required aria-label and title — icon-only links have no visible text. */
  label: string;
  size?: ExternalIconLinkSize;
  /** DOM id. Set it to publish a `cb-` control address (docs/plans/agent-points-at-ui.md). */
  id?: string;
  /**
   * When true, renders a white-pill variant that stays visible on dark
   * backgrounds (image overlays, colored bars). Mirrors the `onDark`
   * pattern from CloseButton.
   */
  onDark?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const SIZE_CLASSES: Record<ExternalIconLinkSize, string> = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
};

function OpenInNewTabIcon({ size }: { size: ExternalIconLinkSize }) {
  const dim = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <svg className={dim} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

export function ExternalIconLink({ href, label, size, id, onDark, className }: ExternalIconLinkProps) {
  size = size ?? "md";
  onDark = onDark ?? false;
  const colorClass = onDark
    ? "bg-white/90 hover:bg-white text-warm-700 shadow"
    : "bg-transparent hover:bg-warm-200 text-warm-500 hover:text-warm-700";
  return (
    <a
      id={id}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        SIZE_CLASSES[size],
        colorClass,
        "rounded-full inline-flex items-center justify-center flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <OpenInNewTabIcon size={size} />
    </a>
  );
}
