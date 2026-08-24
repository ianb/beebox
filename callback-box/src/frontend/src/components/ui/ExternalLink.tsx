import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ExternalLinkVariant = "inline" | "plain" | "button";

export interface ExternalLinkProps {
  href: string;
  /** Stable `cb-` control address for the rendered anchor (see lib/ui-scan). */
  id?: string;
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
  /**
   * If set, the link is treated as a download (`download` HTML attribute);
   * the browser saves the target instead of navigating to it. Pass a string
   * to set the suggested filename. Pairs naturally with `variant="button"`.
   */
  download?: string | boolean;
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
  inline: "text-primary underline hover:text-primary-dark inline-flex items-baseline gap-0.5",
  plain: "hover:text-primary-dark inline-flex items-baseline gap-0.5",
  button:
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-warm-300 rounded hover:bg-warm-50 text-warm-700",
};

export function ExternalLink({ href, id, children, hideIcon, title, variant, download, className }: ExternalLinkProps) {
  hideIcon = hideIcon ?? false;
  variant = variant ?? "inline";
  const isDownload = download !== undefined && download !== false;
  return (
    <a
      id={id}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      download={isDownload ? (download === true ? "" : download) : undefined}
      className={cn(VARIANT_CLASSES[variant], className)}
    >
      <span>{children}</span>
      {hideIcon || isDownload ? null : <ExternalLinkIcon />}
    </a>
  );
}
