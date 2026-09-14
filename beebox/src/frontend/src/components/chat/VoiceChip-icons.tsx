/**
 * Icon shapes for `VoiceChip` and `VoiceChipFace` — split out to keep
 * VoiceChip.tsx under the 300-line cap.
 */

/**
 * How the box answers: aloud, or in writing.
 *
 * The muted state draws a written line rather than a slashed speaker. A slash
 * says *suppressed*, and that is not what happens — the box still answers, it
 * just answers in text (boxholder, 2026-09-14: "bot writing back"). It also
 * keeps this glyph from colliding with the floor glyph beside it, where the box
 * listening ALSO means no speech, for an unrelated reason.
 *
 * The two are orthogonal and both are worth seeing: in narration the box stays
 * silent by default but may speak by exception — when asked, or when the
 * boxholder is hands-busy (`NARRATION_OVERLAY`). Answering in text removes that
 * exception, so a genuine question arrives as a callout instead.
 */
export function SpeakerIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5h14M5 9.5h14M5 14h9M5 18.5h6" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M18.36 5.64a9 9 0 0 1 0 12.72" />
    </svg>
  );
}

/**
 * Who holds the floor. A closed set: the chip shows one glyph per member, so a
 * new mode is a new shape rather than a badge bolted onto an old one.
 *
 * `"box"` is podcast mode — the box talking at length while the boxholder
 * listens. Not built; named because these three are one axis and leaving the
 * slot out is what would make it a redesign later.
 */
export type ConversationFloor = "shared" | "person" | "box";

/**
 * The floor glyph: who is talking at length, and who is taking it in.
 *
 * This replaced a microphone, which could not carry the distinction — voice
 * input uses the mic in BOTH modes, so a mic says "you can talk", never "this is
 * narration" (`issues/bugs/2026-08-06-narration-mode-icon-ambiguous-with-mic.md`).
 * The chip used to draw one mic and dim it to 40% when narration was off, a
 * brightness difference with nothing to compare against.
 *
 * The deeper reason a mic failed: narration is a RELATIONSHIP, and no
 * single-participant picture can show one. It changes what the box does as much
 * as what you do — the box stops answering and starts receiving
 * (`NARRATION_OVERLAY`, `core/chat/session/prompts.ts`: "your turn defaults to
 * silent"). Both participants' states flip together and are perfectly
 * correlated, so this is one control with three values rather than two
 * indicators that would always agree.
 *
 * Two marks, and weight says who holds the floor: even for turn-taking,
 * left-heavy while you narrate, right-heavy for podcast. Deliberately abstract
 * rather than two silhouettes — at 16px a relationship survives as weight, and
 * two little figures do not.
 */
export function FloorIcon({ floor }: { floor: ConversationFloor }) {
  // Person on the left, box on the right; the one holding the floor is the long
  // bar, the one taking it in is the dot.
  const person = floor === "person" ? <path strokeLinecap="round" strokeWidth={2} d="M4 7v10" /> : <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />;
  const box = floor === "box" ? <path strokeLinecap="round" strokeWidth={2} d="M20 7v10" /> : <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />;
  const between = floor === "shared"
    // Turn-taking: the exchange runs both ways.
    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9.5 7.5 12 9 14.5M15 9.5l1.5 2.5L15 14.5M8 12h8" />
    // One side holds the floor: the flow runs toward the listener.
    : floor === "person"
      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h7m-2.5-2.5L15 12l-2.5 2.5" />
      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12H9m2.5-2.5L9 12l2.5 2.5" />;
  return (
    <svg className="w-5 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {person}
      {between}
      {box}
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
