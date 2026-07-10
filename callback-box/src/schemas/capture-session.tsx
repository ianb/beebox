/**
 * Capture session card schema (Phase-2 frontmatter + Markdoc transcript body).
 *
 * Written by the capture preparation worker (`src/core/capture/prepare.ts`)
 * when a recorded/photographed capture session is delivered to chat as a
 * `<capture>` message, and by `cb scan-import` for photo/PDF batches that
 * never touch chat. Frontmatter carries the session metadata and the
 * manifests of child image/audio/file cards (which live in the session's
 * attach scope). The markdown body is the assembled transcript: transcribed
 * speech interleaved, in timeline order, with `{% image %}` markers (where a
 * photo was taken) and `{% silence %}` markers (gaps) — see
 * `src/shared/markdoc-config.ts`.
 *
 * The chat agent — not a background procedure — annotates and files these
 * cards; see `instructions` below.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { splitCardContent, body, cardSchema, type CardSchema } from "../cards/index.js";

/**
 * Current lifecycle: `new` (just written by preparation, not yet delivered
 * or delivery not yet confirmed) → `delivered` (the `<capture>` chat message
 * was sent) → `annotated` (the agent has done its OCR/description pass and
 * committed it). The remaining values (`transcribing`, `transcribed`,
 * `intake-complete`, `extracted`) are legacy — written by the retired
 * `process-captures` pipeline and still present on cards from before this
 * lifecycle shipped. They validate but nothing writes them anymore; treat a
 * card in one of those states as a leftover from the old pipeline (its
 * content is still usable, just triage it like any other card in `new`).
 */
export const CaptureSessionStatus = z.enum([
  "new",
  "delivered",
  "annotated",
  // Legacy (pre-2026-07 pipeline); still validate, nothing writes them now.
  "transcribing",
  "transcribed",
  "intake-complete",
  "extracted",
]);
export type CaptureSessionStatus = z.infer<typeof CaptureSessionStatus>;

const SessionTime = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }).optional(),
  duration: z.string().optional(),
});

const captureSessionFields = {
  status: CaptureSessionStatus.default("new"),
  "session-id": z.string(),
  time: SessionTime.optional(),
  /** Manifest of child image cards (refs into the session's attach scope). */
  images: z.array(z.string()).optional(),
  /** Manifest of child audio cards. */
  "audio-clips": z.array(z.string()).optional(),
  /** Manifest of child uploaded-file cards. */
  files: z.array(z.string()).optional(),
  /** Recording was cut off unexpectedly; the final seconds may be missing. */
  partial: z.boolean().optional(),
  /** One or more clips still need transcription (provider failure at prepare time). */
  "transcription-failed": z.boolean().optional(),
  /** The assembled transcript (markdown + `{% image %}` / `{% silence %}`). */
  body: body(z.string()),
};

export const CaptureSessionSchema: CardSchema = cardSchema("capture-session", {
  description: "Groups the images, audio clips, and files from one recording session, with an assembled timeline transcript as the body",
  category: "synced",
  searchable: true,
  fields: captureSessionFields,
  instructions: `# Capture Session Cards

A capture is a user-recorded batch of photos and/or voice, delivered to chat as a \`<capture doc="...">\` message (or, for \`cb scan-import\` batches, dropped straight into \`box/inbox/\` with no chat message at all — these instructions apply wherever the card is found). The session card groups the images, audio clips, and uploaded files from one recording session; its child cards live inside the session's attach scope (\`{basename}.attach/\`), refs using the \`attach/\` virtual prefix.

Frontmatter:
- \`status\` — \`new\` (just written, not yet annotated) → \`delivered\` (the chat message went out) → \`annotated\` (you've done your annotation pass and committed it). Older cards may carry \`transcribing\`/\`transcribed\`/\`intake-complete\`/\`extracted\` — legacy values from a retired pipeline; treat those cards as leftover \`new\` work.
- \`session-id\` — links back to the capture session.
- \`time\` — \`{ start, end?, duration? }\`.
- \`images\` / \`audio-clips\` / \`files\` — manifests of the child card refs.
- \`partial\` — the recording cut off unexpectedly (crash, disconnect, abandonment). Treat the final seconds of transcript as possibly mid-thought — the tail may be missing, not the person trailing off.
- \`transcription-failed\` — one or more clips still need transcription (the transcription provider was unavailable when this was prepared). The capture was still delivered rather than held hostage to the outage; a later \`cb transcribe\`/HQ pass can fill in the missing text.

Body — the assembled transcript, a timeline of transcribed speech interleaved with:
- \`{% image ref="photo-001.image.card" /%}\` — where a photo was taken (description/filename come from the referenced image card).
- \`{% silence duration="15s" /%}\` — gaps of 10+ seconds.

This body is generated, not hand-written — don't edit it directly; if something needs correcting, fix the source (a child card's transcript/description) and re-derive, or note the correction in your own annotation instead.

**Your duties on a capture card, in order:**
1. **Annotate by default.** OCR any images with text and add descriptions for the rest, via subagents reading the actual image files (don't invent content from the transcript alone) — write the results onto the child image cards, commit, and set this card's \`status\` to \`annotated\`.
2. **Then file it.** Either \`cb mv\` the card (and its attach scope) out of \`tmp-capture/\` to wherever it belongs — a project, a person, a memo, a record — or, if you can fully process the capture on the spot (e.g. it's just a quick note that becomes a todo), complete that work and **delete the card** instead of filing it.
3. **\`tmp-capture/\` must not accumulate.** It's a landing zone, not storage — a capture left there is unfinished work. If you can't finish filing it in one turn, say so and come back to it; don't leave it silently.`,
});

/** Frontmatter-only object schema (the body field lives outside Zod). */
const CaptureSessionObject = z.object({
  status: CaptureSessionStatus.default("new"),
  "session-id": z.string(),
  time: SessionTime.optional(),
  images: z.array(z.string()).optional(),
  "audio-clips": z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  partial: z.boolean().optional(),
  "transcription-failed": z.boolean().optional(),
});
export type CaptureSessionFrontmatter = z.infer<typeof CaptureSessionObject>;
/** Back-compat alias. */
export type CaptureSession = CaptureSessionFrontmatter;

/**
 * A capture session's parsed frontmatter plus its raw transcript body, or
 * null if the text has no frontmatter / fails validation. Used by the
 * timeline assembler and other readers that work with the card directly.
 */
export interface ParsedCaptureSession {
  frontmatter: CaptureSessionFrontmatter;
  body: string;
}

export function parseCaptureSession(content: string): ParsedCaptureSession | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  const parsed = CaptureSessionObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  return { frontmatter: parsed.data, body: split.body };
}

/**
 * Template for creating a capture session card — frontmatter manifests with
 * an empty transcript body (filled in later by `assemble-timeline`).
 *
 * `imageRefs`, `audioRefs`, `fileRefs` are bare child-card filenames
 * (e.g. `photo-001.image.card`). They're emitted with the `attach/` virtual
 * prefix, pointing into the session's attach scope.
 */
export function createCaptureSessionTemplate(options: {
  sessionId: string;
  startedAt: string;
  endedAt?: string | null;
  imageRefs: string[];
  audioRefs: string[];
  fileRefs?: string[];
}): string {
  const duration = options.endedAt
    ? formatDuration(new Date(options.endedAt).getTime() - new Date(options.startedAt).getTime())
    : undefined;

  const time: Record<string, string> = { start: options.startedAt };
  if (options.endedAt) time.end = options.endedAt;
  if (duration !== undefined) time.duration = duration;

  const fields: Record<string, unknown> = {
    status: "new",
    "session-id": options.sessionId,
    time,
    images: options.imageRefs.map((ref) => `attach/${ref}`),
    "audio-clips": options.audioRefs.map((ref) => `attach/${ref}`),
  };
  const fileRefs = options.fileRefs ?? [];
  if (fileRefs.length > 0) fields.files = fileRefs.map((ref) => `attach/${ref}`);

  return `---\n${stringifyYaml(fields)}---\n`;
}

/**
 * Format a duration in milliseconds to a human-readable string like "4m2s" or "1h15m".
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
