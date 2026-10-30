/**
 * The session chip's face, apart from its menu so the theme studio renders
 * the same face with fixed props (see `chat/everywhere/InteractiveChat/SessionChip.tsx`).
 */

import type { DropdownTriggerProps } from "../ui/Dropdown";
import { CaretIcon } from "./PlacePillFace";

/**
 * Chat properties. From `sm:` up the adjacent "Chat" label supplies the
 * subject; below it the glyph carries the chip alone, which is why it is the
 * half that stays — the word costs three times the width of the mark, and at
 * phone size the bar has none to spare.
 */
function ChatSettingsIcon() {
  return (
    <svg className="block w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h4m4 0h10M3 17h10m4 0h4" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
}

/**
 * One instrument: below/at/above the box default, with an attached star for
 * another harness. Unknown tier leaves the dial absent, never implying "same";
 * a known harness difference remains visible independently.
 */
function ModelGaugeIcon({ drift, offEngine }: { drift: "above" | "below" | "same" | null; offEngine: boolean }) {
  const needle = drift === "below" ? "M12 17 6.8 12.2" : drift === "above" ? "M12 17 17.2 12.2" : "M12 17V9.8";
  return (
    <svg className={drift === null ? "w-3 h-4 shrink-0" : "w-5 h-4 shrink-0"} viewBox={drift === null ? "17 0 13 24" : "0 0 30 24"} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {drift === null ? null : (
        <g transform="translate(0 -1.5)">
          <path d="M3 18a9 9 0 0 1 18 0M4.5 12l1.3.7M12 7v1.5M19.5 12l-1.3.7" />
          <path d={needle} />
          <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </g>
      )}
      {offEngine ? <path d="m23 1 1.2 3.8L28 6l-3.8 1.2L23 11l-1.2-3.8L18 6l3.8-1.2Z" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

/**
 * The chip as drawn: settings glyph, "Chat", the model gauge and the session
 * label. Presentational, so the theme studio renders this same face with
 * fixed props.
 */
export function SessionChipFace({ label, drift, offEngine, accessibleName, onClick, ariaProps }: {
  label: string | null;
  drift: "above" | "below" | "same" | null;
  offEngine: boolean;
  accessibleName: string;
  onClick: DropdownTriggerProps["toggle"];
  ariaProps: DropdownTriggerProps["ariaProps"];
}) {
  // Keep the editorial title when available; the persistent "Chat" label
  // identifies the menu even without a title or at narrow widths.
  const titled = label !== null && label !== "";
  return (
    <button
      type="button"
      id="bbx-nav-session"
      data-bbx-reveal
      data-bbx-does="opens the session menu — new session, recent chats, model, advanced"
      onClick={onClick}
      className="min-h-[40px] min-w-[40px] px-2 sm:px-3 flex items-center justify-center gap-1.5 rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      title={accessibleName}
      aria-label={accessibleName}
      {...ariaProps}
    >
      <ChatSettingsIcon />
      <span className="hidden sm:inline shrink-0 font-medium">Chat</span>
      {drift === null && !offEngine ? null : <ModelGaugeIcon drift={drift} offEngine={offEngine} />}
      {titled ? <span className="hidden sm:inline max-w-[11rem] truncate">{label}</span> : null}
      <CaretIcon />
    </button>
  );
}
