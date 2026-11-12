/**
 * The clickable speaker icon on an assistant message, with a dropdown for
 * controlling and replaying its speech.
 *
 * Menu, top to bottom:
 *   - Stop          — stop the current speech sequence (disabled if nothing
 *                     is playing). Does NOT mute; see VoiceChip for that.
 *   - Replay        — replay all of this message's speech from the start.
 *   - Fast-forward  — abort the current segment and play the next. Only
 *                     shown when this message has multiple segments; disabled
 *                     unless this message is playing and a next segment exists.
 *   - Replay from:  — only when multiple segments: jump straight to a chosen
 *                     segment, listed by a short prefix of its text.
 */

import { Menu } from "../ui/Menu";
import { MenuItem, MenuDivider } from "../ui/menu-item";
import type { SpeechSegment } from "../../lib/audio/speech-parsing/parse";
import { snippet } from "../../lib/snippet";

const MAX_LABEL_CHARS = 50;

function chunkLabel(segment: SpeechSegment): string {
  return snippet(segment.displayText, MAX_LABEL_CHARS);
}

function SpeakerGlyph({ playing }: { playing: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`inline-block w-4 h-4 align-text-bottom ${
        playing ? "text-card-pen animate-pulse" : "text-card-pen opacity-40"
      }`}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function ForwardGlyph() {
  // Triangle + bar: skip to the next segment.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4">
      <path d="M5 5l9 7-9 7z" />
      <rect x="16" y="5" width="2.5" height="14" rx="0.75" />
    </svg>
  );
}

function ReloadGlyph() {
  // Circular arrow: replay from the start.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-4 h-4">
      <polyline points="21 4 21 9 16 9" />
      <path d="M20.4 9A8 8 0 1 0 21 14" />
    </svg>
  );
}

export interface SpeechMenuProps {
  segments: SpeechSegment[];
  /** This message's speech is currently playing. */
  playing: boolean;
  /** Some speech (this message or another) is currently playing. */
  anyPlaying: boolean;
  /** A next segment exists in the currently-playing queue. */
  canSkip: boolean;
  onStop: () => void;
  onSkip: () => void;
  onReplay: (fromIndex: number) => void;
}

export function SpeechMenu({ segments, playing, anyPlaying, canSkip, onStop, onSkip, onReplay }: SpeechMenuProps) {
  const hasMultiple = segments.length > 1;

  return (
    <Menu
      width="w-64"
      dense
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Speech options"
          className="inline-flex items-center cursor-pointer leading-none"
          {...ariaProps}
        >
          <SpeakerGlyph playing={playing} />
        </button>
      )}
    >
      <MenuItem icon={<StopGlyph />} disabled={!anyPlaying} onClick={onStop}>Stop</MenuItem>
      <MenuItem icon={<ReloadGlyph />} onClick={() => onReplay(0)}>Replay</MenuItem>
      {hasMultiple ? (
        <MenuItem icon={<ForwardGlyph />} disabled={!(playing && canSkip)} onClick={onSkip}>Fast-forward</MenuItem>
      ) : null}
      {hasMultiple ? (
        <>
          <MenuDivider />
          <div className="px-3 py-0.5 text-[0.6875rem] uppercase tracking-wide text-warm-400">Replay from:</div>
          {segments.map((segment, i) => (
            <MenuItem key={i} onClick={() => onReplay(i)}>
              <span className="block truncate">{chunkLabel(segment)}</span>
            </MenuItem>
          ))}
        </>
      ) : null}
    </Menu>
  );
}
