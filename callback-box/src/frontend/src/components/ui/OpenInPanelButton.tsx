import { cn } from "../../lib/cn";

export type OpenInPanelButtonSize = "sm" | "md";

export interface OpenInPanelButtonProps {
  onClick: () => void;
  /** Required aria-label and title — the icon-only button has no visible text. */
  label: string;
  size?: OpenInPanelButtonSize;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const SIZE_CLASSES: Record<OpenInPanelButtonSize, string> = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
};

/** Side-panel glyph — a framed rectangle with a divided right column. Matches
 *  the recent-files dropdown's "open as side panel" affordance (FileEntry). */
function SidePanelIcon({ size }: { size: OpenInPanelButtonSize }) {
  const dim = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <svg className={dim} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 4v16" />
    </svg>
  );
}

/**
 * Icon-only button that opens the file in the chat's companion (side) pane —
 * the sibling of {@link ExternalIconLink}'s open-in-new-tab action. Styled to
 * sit next to it in compact headers (FileView chat header).
 */
export function OpenInPanelButton({ onClick, label, size, className }: OpenInPanelButtonProps) {
  size = size ?? "md";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        SIZE_CLASSES[size],
        "bg-transparent hover:bg-warm-200 text-warm-500 hover:text-warm-700",
        "rounded-full inline-flex items-center justify-center flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <SidePanelIcon size={size} />
    </button>
  );
}
