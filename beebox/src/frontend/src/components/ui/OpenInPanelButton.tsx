import { iconGlyphClass, iconLinkClasses, type ExternalIconLinkSize } from "./ExternalIconLink";

export type OpenInPanelButtonSize = ExternalIconLinkSize;

export interface OpenInPanelButtonProps {
  onClick: () => void;
  /** Required aria-label and title — the icon-only button has no visible text. */
  label: string;
  size?: OpenInPanelButtonSize;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/** Side-panel glyph — a framed rectangle with a divided right column. Matches
 *  the recent-files dropdown's "open as side panel" affordance (FileEntry). */
function SidePanelIcon({ size }: { size: OpenInPanelButtonSize }) {
  return (
    <svg className={iconGlyphClass(size)} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
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
      className={iconLinkClasses({ size, onDark: false, className })}
    >
      <SidePanelIcon size={size} />
    </button>
  );
}
