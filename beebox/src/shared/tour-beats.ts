/**
 * The beats of a `tour` card (`docs/implemented-plans/conversation-strip.md`, Track B).
 *
 * A tour's body is markdown. Each line that starts with `## ` opens a beat:
 * the heading text is the beat's title and the markdown up to the next such
 * line is its content. Text before the first heading is the tour's
 * introduction and belongs to no beat. A `## ` line inside a fenced code
 * block is content, not a heading. Markdown's optional closing hashes
 * (`## Arrival ##`) are not part of the title.
 *
 * Shared by the schema's `validate` hook (server) and the tour renderer
 * (browser), so both agree on what a beat is.
 */

export interface TourBeat {
  /** The heading text, trimmed. Identifies the beat within its card. */
  title: string;
  /** The markdown under the heading, trimmed. May be empty. */
  markdown: string;
}

export interface ParsedTour {
  /** Markdown before the first beat heading, trimmed. May be empty. */
  introduction: string;
  beats: TourBeat[];
}

const BEAT_HEADING = /^## +(\S.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Split a tour card's body into its introduction and beats. */
export function parseTourBeats(body: string): ParsedTour {
  const beats: Array<{ title: string; lines: string[] }> = [];
  const introduction: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    const marker = fenceMatch?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence)) fence = null;
    }
    const heading = fence === null && marker === undefined ? BEAT_HEADING.exec(line) : null;
    const title = heading?.[1];
    if (title !== undefined) {
      beats.push({ title: title.replace(/\s+#+\s*$/, "").trim(), lines: [] });
      continue;
    }
    const open = beats.at(-1);
    if (open === undefined) introduction.push(line);
    else open.lines.push(line);
  }
  return {
    introduction: introduction.join("\n").trim(),
    beats: beats.map((beat) => ({ title: beat.title, markdown: beat.lines.join("\n").trim() })),
  };
}

/** The index of the beat titled `current`, or null when `current` is unset or names no beat. */
export function currentBeatIndex(beats: readonly TourBeat[], current: string | undefined): number | null {
  if (current === undefined) return null;
  const wanted = current.trim();
  const index = beats.findIndex((beat) => beat.title === wanted);
  return index === -1 ? null : index;
}
