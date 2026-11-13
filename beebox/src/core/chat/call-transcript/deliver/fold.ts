/**
 * Fold a transcribed call into one `<call>` message (docs/plans/chat-calls.md,
 * Track G). Pure: each person's recording becomes utterances placed by real
 * wall-clock time (`firstAudioAtMs + word.start`), merged with what happened
 * in the chat while transcription was on. Device clocks are trusted; a member
 * whose clock was more than a second off the box's only earns a note.
 */

import type { CallUserMessage } from "../../../../shared/delivered-call-message.js";
import type { VoiceHqWord } from "../../../capture/staging-schema.js";
import type { PresentPerson } from "../../presence/room.js";
import { withPunctuation } from "./punctuate.js";

/** A pause longer than this starts a new utterance. */
const UTTERANCE_GAP_SECONDS = 1.2;
const SKEW_NOTE_MS = 1000;

export interface FoldRecording {
  person: PresentPerson;
  /** The member's real clock minus the server's at join. */
  clockOffsetMs: number;
  /** Null when the recording never finished transcribing: missing, failed, or out of time. */
  result: { firstAudioAtMs: number; text: string; words: VoiceHqWord[] | null } | null;
}

/** One line of chat activity, already worded ("Tomas (typed): …"), at real time `atMs`. */
export interface FoldActivity {
  atMs: number;
  text: string;
}

export interface TranscribingChange {
  by: PresentPerson;
  atMs: number;
  on: boolean;
}

export interface FoldInput {
  /** Real wall-clock ms. */
  startedAt: number;
  endedAt: number;
  people: PresentPerson[];
  recordings: FoldRecording[];
  activity: FoldActivity[];
  transcribingChanges: TranscribingChange[];
}

interface Line {
  atMs: number;
  text: string;
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Words → utterances, split where the speaker paused longer than {@link UTTERANCE_GAP_SECONDS}. */
function utterances(opts: { name: string; firstAudioAtMs: number; words: VoiceHqWord[] }): Line[] {
  const lines: Line[] = [];
  let current: VoiceHqWord[] = [];
  const flush = (): void => {
    const first = current.at(0);
    if (first !== undefined) {
      lines.push({ atMs: opts.firstAudioAtMs + first.start * 1000, text: `${opts.name}: ${current.map((w) => w.text.trim()).join(" ")}` });
    }
    current = [];
  };
  for (const word of opts.words.toSorted((a, b) => a.start - b.start)) {
    const last = current.at(-1);
    if (last !== undefined && word.start - last.end > UTTERANCE_GAP_SECONDS) flush();
    current.push(word);
  }
  flush();
  return lines;
}

/** The spans of real time transcription was on; one still on at the end runs to `endedAt`. */
function transcribedSpans(changes: TranscribingChange[], endedAt: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let since: number | null = null;
  for (const change of changes.toSorted((a, b) => a.atMs - b.atMs)) {
    if (change.on && since === null) since = change.atMs;
    if (!change.on && since !== null) {
      spans.push({ from: since, to: change.atMs });
      since = null;
    }
  }
  if (since !== null) spans.push({ from: since, to: endedAt });
  return spans;
}

function names(people: PresentPerson[]): string[] {
  return [...new Set(people.map((p) => p.name))];
}

function speechLines(recordings: FoldRecording[]): { lines: Line[]; missing: PresentPerson[]; untimed: PresentPerson[] } {
  const lines: Line[] = [];
  const missing: PresentPerson[] = [];
  const untimed: PresentPerson[] = [];
  for (const { person, result } of recordings) {
    if (result === null) {
      missing.push(person);
    } else if (result.words !== null) {
      lines.push(...utterances({ name: person.name, firstAudioAtMs: result.firstAudioAtMs, words: withPunctuation(result.words, result.text) }));
    } else if (result.text.trim() !== "") {
      // No word timing: the whole recording sits at its start, flagged as partial.
      untimed.push(person);
      lines.push({ atMs: result.firstAudioAtMs, text: `${person.name}: ${result.text.trim()}` });
    }
  }
  return { lines, missing, untimed };
}

function partialNote(missing: PresentPerson[], untimed: PresentPerson[]): string | null {
  const notes = [
    ...names(missing).map((name) => `${name}'s audio could not be transcribed`),
    ...names(untimed).map((name) => `${name}'s speech has no word timing and is placed where the recording starts`),
  ];
  return notes.length === 0 ? null : `${notes.join("; ")}.`;
}

function skewNote(recordings: FoldRecording[]): string | null {
  const skewed = new Map<string, number>();
  for (const r of recordings) {
    if (Math.abs(r.clockOffsetMs) > SKEW_NOTE_MS) skewed.set(r.person.name, Math.round(Math.abs(r.clockOffsetMs) / 1000));
  }
  if (skewed.size === 0) return null;
  const each = [...skewed].map(([name, seconds]) => `${name}'s clock was ${String(seconds)} s off`);
  return `${each.join("; ")}; order may be wrong near overlaps.`;
}

export function foldCall(input: FoldInput): CallUserMessage {
  const { startedAt, endedAt } = input;
  const spans = transcribedSpans(input.transcribingChanges, endedAt);
  const during = (atMs: number): boolean => spans.some((s) => atMs >= s.from && atMs <= s.to);
  const speech = speechLines(input.recordings);
  const lines: Line[] = [
    ...input.transcribingChanges.map((c) => ({ atMs: c.atMs, text: `${c.by.name} turned transcription ${c.on ? "on" : "off"}` })),
    ...speech.lines,
    ...input.activity.filter((a) => during(a.atMs)),
  ];
  // Stable sort: lines at the same moment keep source order, and overlapping speech stays two lines.
  const transcript = lines
    .toSorted((a, b) => a.atMs - b.atMs)
    .map((line) => `[${clock(line.atMs - startedAt)}] ${line.text}`)
    .join("\n");
  return {
    kind: "call",
    people: names(input.people).join(", "),
    duration: clock(endedAt - startedAt),
    started: new Date(startedAt).toISOString(),
    partial: partialNote(speech.missing, speech.untimed),
    skew: skewNote(input.recordings),
    transcript,
  };
}
