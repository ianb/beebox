/** Shared SVG shapes for the voice chip and its menu previews. */

import type { ReactElement } from "react";

/** Podcast ("box") is drawn for completeness; the mode is not yet reachable. */
export type ConversationFloor = "shared" | "person" | "box";

/**
 * The face carries two facts and draws exactly one mark for each.
 *
 * It used to draw four: a person, an arrow, a bot, and the bot's output, strung
 * across a 50×16 strip. Every mark was then about 8px wide with a 1.3px stroke,
 * which resolves on a desktop and reads as three unrelated glyphs on a phone
 * (`issues/bugs/2026-09-15-mobile-app-bar-crowds-place-label.md`, second
 * problem). Fewer marks is the only thing that makes each mark bigger: these
 * two are ~12px in a 20×16 box rendered at 24×20, half again the old size, and
 * the strip is 26px narrower — which the app bar also needed.
 *
 * The participants went, not the facts. `voiceChipLabel` says both outright in
 * words, the menu rows name them, and the arrow keeps its own two ends: two
 * opposed arrows are an exchange, one arrow is a one-way floor. That is the
 * distinction the closed mic bug turned on
 * (`issues/closed/bugs/2026-08-06-narration-mode-icon-ambiguous-with-mic.md`) —
 * a mic could not carry it because voice input is the same in both modes,
 * whereas direction differs by construction.
 *
 * Speaker labels (diarization) no longer have a mark anywhere. It used to be
 * the second head on the person; with no person drawn it lives in the
 * accessible name and the menu's service row.
 */

/** Who holds the floor — an exchange, or one way. */
function FloorMark({ floor }: { floor: ConversationFloor }): ReactElement {
  const paths = {
    shared: "M.5 5h6.5m-2-2 2 2-2 2M9 11H2.5m2-2-2 2 2 2",
    person: "M.5 8h8.5m-2.5-2.5L9 8 6.5 10.5",
    box: "M9 8H.5m3-2.5L.5 8 3 10.5",
  } satisfies Record<ConversationFloor, string>;
  return <path d={paths[floor]} />;
}

/**
 * How the box answers — sound, or writing.
 *
 * The speaker body is drawn in BOTH states and only what leaves it changes.
 * Two reasons. It says the box is still answering either way: written lines on
 * their own read as a list — a hamburger menu, in the first drawing of this
 * face — and a slash would say *suppressed*, which is not what happens. And a
 * body shared by both values is what makes this one axis with two settings
 * rather than two unrelated icons sitting next to the arrow.
 */
function AnswerMark({ muted }: { muted: boolean }): ReactElement {
  return (
    <>
      <path d="M11 6h1.5L14.5 4v8l-2-2H11z" />
      <path d={muted ? "M16 5h3.5M16 8h2.5M16 11h3.5" : "M16 6.4a2.4 2.4 0 0 1 0 3.2M18 4.6a5.2 5.2 0 0 1 0 6.8"} />
    </>
  );
}

/** Both facts, side by side — the chip's whole face. */
export function ConversationIcon({ floor, muted }: {
  floor: ConversationFloor;
  muted: boolean;
}): ReactElement {
  return (
    <svg className="w-[27px] h-5 shrink-0" viewBox="0 0 22 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <FloorMark floor={floor} />
      <AnswerMark muted={muted} />
    </svg>
  );
}

/** The answer mark alone, for the menu's mute row — the same shape the face wears. */
export function SpeakerIcon({ muted }: { muted: boolean }): ReactElement {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="10 2 11 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <AnswerMark muted={muted} />
    </svg>
  );
}

/** The floor mark alone, for the menu's narration row — the same shape the face wears. */
export function FloorIcon({ floor }: { floor: ConversationFloor }): ReactElement {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="-1 2 11 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <FloorMark floor={floor} />
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
