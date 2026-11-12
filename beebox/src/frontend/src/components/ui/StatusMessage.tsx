import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMaterial } from "./material";

export type StatusMessageVariant = "pane" | "menu" | "inline";

export interface StatusMessageProps {
  children: ReactNode;
  /**
   * `pane` (default) is a roomy `p-8` placeholder for a whole pane. `menu` is
   * a compact small-text row inside a dropdown or list panel. `inline` is
   * small text with no padding, for a line inside a card or section whose own
   * padding already spaces it.
   */
  variant?: StatusMessageVariant;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /**
   * The placeholder stands for content still loading: `aria-busy` asks screen
   * readers to hold the region's announcement until the result replaces the
   * loading text, and `bbx browser screenshot --card` waits for it to clear.
   */
  busy?: boolean;
  /** Take the soft ink of the enclosing card's material. Defaults to the nearest Card's. */
  material?: boolean;
}

const VARIANT_CLASSES: Record<StatusMessageVariant, string> = {
  pane: "p-8",
  menu: "px-3 py-2 text-sm",
  inline: "text-sm",
};

/**
 * A placeholder while there is nothing to show: loading, empty, or not
 * found. It stays one `role="status"` region from loading to result, so the
 * result is announced as a change inside an existing live region. Errors use
 * `ErrorText`.
 */
export function StatusMessage({ children, variant, className, busy, material }: StatusMessageProps) {
  const ink = useMaterial(material) ? "text-card-soft" : "text-warm-700";
  return <div role="status" aria-busy={busy === true ? true : undefined} className={cn(VARIANT_CLASSES[variant ?? "pane"], ink, className)}>{children}</div>;
}
