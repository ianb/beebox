import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ExternalLinkVariant = "inline" | "plain" | "button";

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  hideIcon?: boolean;
  title?: string;
  /**
   * Styling variant.
   * - `"inline"`: underlined text link (default, for prose).
   * - `"plain"`: no underline, inherits parent styling (for use inside styled containers where the icon is the only external indicator).
   * - `"button"`: styled as a secondary button (white background, border, padding). Use when the link stands alone as a call-to-action.
   */
  variant?: ExternalLinkVariant;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

function ExternalLinkIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 inline-block -translate-y-px"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

const VARIANT_CLASSES: Record<ExternalLinkVariant, string> = {
  inline: "text-plum underline hover:text-plum-dark inline-flex items-baseline gap-0.5",
  plain: "hover:text-plum-dark inline-flex items-baseline gap-0.5",
  button:
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-warm-300 rounded hover:bg-warm-50 text-warm-700",
};

export function ExternalLink({ href, children, hideIcon = false, title, variant = "inline", className }: ExternalLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={cn(VARIANT_CLASSES[variant], className)}
    >
      <span>{children}</span>
      {hideIcon ? null : <ExternalLinkIcon />}
    </a>
  );
}
