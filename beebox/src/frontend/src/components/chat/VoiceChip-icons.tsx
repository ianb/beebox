/** Shared SVG shapes for the voice chip and its menu previews. */

import type { ReactElement } from "react";

/** Podcast ("box") is drawn for completeness; the mode is not yet reachable. */
export type ConversationFloor = "shared" | "person" | "box";

function PersonMark(): ReactElement {
  return (
    <>
      <circle cx="4.5" cy="5" r="2.2" />
      <path d="M1 13v-1.5a3.5 3.5 0 0 1 7 0V13" />
    </>
  );
}

function BotMark(): ReactElement {
  return (
    <g transform="translate(25 1)">
      <path d="M4.5 3V1.5M3 1.5h3" />
      <rect x=".8" y="4" width="7.4" height="8" rx="1.5" />
      <path d="M3 9.8h3" />
      <circle cx="3" cy="7" r=".65" fill="currentColor" stroke="none" />
      <circle cx="6" cy="7" r=".65" fill="currentColor" stroke="none" />
    </g>
  );
}

function FloorMarks({ floor, diarizationEnabled }: { floor: ConversationFloor; diarizationEnabled: boolean }): ReactElement {
  const arrows = {
    shared: "M12 5h8l-2-2M20 11h-8l2 2",
    person: "M12 8h8m-3-3 3 3-3 3",
    box: "M20 8h-8m3-3-3 3 3 3",
  } satisfies Record<ConversationFloor, string>;
  return (
    <>
      <g transform="translate(0 1)">
        {diarizationEnabled ? (
          <>
            <g transform="translate(0 2) scale(.7)"><PersonMark /></g>
            <g transform="translate(4.5 -1) scale(.7)"><PersonMark /></g>
          </>
        ) : <PersonMark />}
      </g>
      <path d={arrows[floor]} />
      <BotMark />
    </>
  );
}

function AnswerMarks({ muted }: { muted: boolean }): ReactElement {
  return <path d={muted ? "M37 4h11M37 8h8M37 12h11" : "M39 6a3 3 0 0 1 0 4M42 3.5a6.5 6.5 0 0 1 0 9"} />;
}

/**
 * One human (or diarized group), arrows, and one bot carrying its answer style.
 * Floor and answer channel remain independent: narration permits spoken
 * exceptions unless answers are explicitly in text. The shared bot connects
 * those facts without drawing it twice or making both participants emit sound.
 */
export function ConversationIcon({ floor, muted, diarizationEnabled }: {
  floor: ConversationFloor;
  muted: boolean;
  diarizationEnabled: boolean;
}): ReactElement {
  return (
    <svg className="w-[50px] h-4 shrink-0" viewBox="0 0 50 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <FloorMarks floor={floor} diarizationEnabled={diarizationEnabled} />
      <AnswerMarks muted={muted} />
    </svg>
  );
}

/** The same bot and output marks, isolated for the answer-channel menu row. */
export function SpeakerIcon({ muted }: { muted: boolean }): ReactElement {
  return (
    <svg className="w-[25px] h-4 shrink-0" viewBox="25 0 25 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <BotMark />
      <AnswerMarks muted={muted} />
    </svg>
  );
}

/** The same participants and arrows, isolated for the narration menu row. */
export function FloorIcon({ floor, diarizationEnabled }: { floor: ConversationFloor; diarizationEnabled: boolean }): ReactElement {
  return (
    <svg className="w-[34px] h-4 shrink-0" viewBox="0 0 34 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <FloorMarks floor={floor} diarizationEnabled={diarizationEnabled} />
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
