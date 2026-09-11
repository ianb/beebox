/**
 * Icon shapes for `VoiceChip` and `VoiceChipFace` — split out to keep
 * VoiceChip.tsx under the 300-line cap.
 */

/**
 * Speaker icon reflecting mute state — the same shapes `MuteButton` used
 * (now retired).
 */
export function SpeakerIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM17 9l4 6m0-6-4 6" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M18.36 5.64a9 9 0 0 1 0 12.72" />
    </svg>
  );
}

/** Mic icon representing narration (input) mode. */
export function MicIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 19v3" />
    </svg>
  );
}

/** Sparkle icon representing HQ (high-quality) dictation mode. */
export function HqIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3zM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15zM19 14l.9 2.4L22 17.3l-2.1.9L19 20.6l-.9-2.4L16 17.3l2.1-.9L19 14z" />
    </svg>
  );
}
