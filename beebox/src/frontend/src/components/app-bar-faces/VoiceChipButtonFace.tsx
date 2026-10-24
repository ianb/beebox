/**
 * The voice chip's trigger, apart from its menu and queries so the theme
 * studio renders the same chip with fixed props (see `chat/VoiceChip/view.tsx`).
 * `children` is the drawing, `VoiceChipFace`.
 */

import type { ReactNode } from "react";
import type { DropdownTriggerProps } from "../ui/Dropdown";

export function VoiceChipButtonFace({ label, onClick, ariaProps, children }: {
  /** Accessible name and title: the voice state, plus any notice. */
  label: string;
  onClick: DropdownTriggerProps["toggle"];
  ariaProps: DropdownTriggerProps["ariaProps"];
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      id="bbx-nav-voice"
      data-bbx-reveal
      data-bbx-does="opens the voice menu — mute, narration mode, transcription services"
      onClick={onClick}
      className="min-h-[40px] px-2 sm:px-[11px] flex items-center justify-center rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      title={label}
      aria-label={label}
      {...ariaProps}
    >
      {children}
    </button>
  );
}
