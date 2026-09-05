/**
 * Text and speaker post-processing for Voxtral transcripts.
 *
 * Voxtral's top-level `text` sometimes concatenates sentence-end segments
 * without spacing, and its diarized segments carry per-speaker ids that
 * need rewriting into readable labels. These helpers handle rebuilding
 * transcript text from segments, repairing missing spaces, formatting
 * speaker labels, and session-tagging speaker numbers across recordings.
 */

/**
 * Rebuild transcript text from Voxtral segments — segments carry the
 * authoritative per-chunk text without the inter-sentence spacing bug
 * that affects the top-level `text` field. Joined with a single space;
 * empty/whitespace-only segments dropped. Returns null when no usable
 * segment text is available (callers fall back to `text`).
 *
 * Only safe in the non-word-timestamps path — when word timestamps are
 * on, each segment is a single word and joining is the caller's job.
 */
export function joinSegmentTexts(
  segments: Array<{ text: string }> | undefined,
): string | null {
  if (!segments || segments.length === 0) return null;
  const pieces = segments
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0);
  if (pieces.length === 0) return null;
  return pieces.join(" ");
}

/**
 * Safety net for when `segments` is empty — same intent as joining from
 * segments, but applied directly to the joined text. Inserts a space
 * after `.`/`!`/`?` when the next char is a letter, leaving decimals,
 * money, and ellipses alone.
 */
export function repairMissingSentenceSpaces(text: string): string {
  return text.replace(/([!.?])([A-Za-z])/g, "$1 $2");
}

/**
 * Build a speaker-prefixed transcript from Voxtral diarized segments.
 * Consecutive segments from the same speaker are merged into one block.
 * Returns null if no segments have a speaker_id (e.g. mono speaker, or
 * diarization didn't run).
 */
export function buildDiarizedText(
  segments: Array<{ text: string; speaker_id?: string | null }> | undefined,
): string | null {
  if (!segments || segments.length === 0) return null;
  if (!segments.some((s) => typeof s.speaker_id === "string" && s.speaker_id.length > 0)) {
    return null;
  }
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  function flush(): void {
    if (currentSpeaker === null || currentText.length === 0) return;
    lines.push(`${formatSpeakerLabel(currentSpeaker)}: ${currentText.join(" ").trim()}`);
    currentText = [];
  }
  for (const seg of segments) {
    const speaker = (typeof seg.speaker_id === "string" && seg.speaker_id.length > 0)
      ? seg.speaker_id
      : "unknown";
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    currentText.push(seg.text.trim());
  }
  flush();
  return lines.join("\n");
}

/**
 * Find the most recent speaker-letter used in prior text (e.g. a chat
 * session log). Scans for `Speaker N<L>` where L is A-Z and returns the
 * last L found, or null if none. Used to advance the per-recording
 * letter so the agent can tell that speakers in one recording aren't
 * the same people as the same numbers in a different recording.
 */
export function findLastSpeakerLetter(text: string): string | null {
  const re = /\bSpeaker \d+([A-Z])\b/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1] ?? last;
  return last;
}

/**
 * Next letter A-Z, wrapping Z→A. Null input → "A".
 */
export function nextSpeakerLetter(prev: string | null): string {
  if (prev === null || prev === "Z") return "A";
  const code = prev.codePointAt(0);
  if (code === undefined) return "A";
  return String.fromCodePoint(code + 1);
}

/**
 * Rewrite raw Voxtral speaker labels ("Speaker 0", "Speaker 1", …) into
 * session-tagged 1-indexed labels ("Speaker 1A", "Speaker 2A", …) so the
 * agent sees a fresh identifier per recording.
 */
export function relabelDiarizedSpeakers(text: string, letter: string): string {
  return text.replace(/\bSpeaker (\d+)\b/g, (_, n) => `Speaker ${Number(n) + 1}${letter}`);
}

function formatSpeakerLabel(speakerId: string): string {
  // "speaker_0" → "Speaker 0", "speaker_1" → "Speaker 1", fallback to raw.
  const m = speakerId.match(/^speaker[_-]?(\d+)$/i);
  if (m) return `Speaker ${m[1]}`;
  return speakerId;
}
