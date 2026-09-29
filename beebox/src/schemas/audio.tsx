/**
 * Audio card schema — audio clips from capture sessions.
 *
 * Created by the capture preparation worker, which also fills in
 * the transcript and sets duration on the filename during its
 * deterministic transcription pass (`src/core/capture/prepare/core.ts`). A
 * `transcript:` means the clip is transcribed; a clip whose transcription
 * failed at prepare time has none — see `transcription-error:` below.
 *
 * Layout: `audio-001.audio.card` next to `audio-001.attach/audio-001.webm`.
 * Word-level timing data lives alongside as
 * `audio-001.attach/audio-001.timing.json`.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../exports/cards.js";
import { MediaViaSchema, type MediaVia } from "../cards/media-via.js";

const FilenameEntry = z.object({
  ref: z.string(),
  via: MediaViaSchema,
  duration: z.string().optional(),
});

const TranscriptionError = z.object({
  permanent: z.boolean(),
  code: z.string().optional(),
  "attempted-at": z.string().datetime({ offset: true }).optional(),
  message: z.string(),
});

export const AudioSchema = cardSchema("audio", {
  brief: "A recorded speech clip",
  description: "A recorded speech clip from a capture session — audio file in the attach scope, transcript filled on transcription",
  category: "synced",
  fields: {
    filename: FilenameEntry,
    transcript: z.string().optional(),
    "transcription-error": TranscriptionError.optional(),
  },
  instructions: `# Audio Cards

An audio card represents a chunk of recorded speech from a capture
session. The audio file itself lives in the card's attach scope,
pointed to by \`filename.ref:\` (attach scope: see ABOUT_CARDS).

Frontmatter:
- \`filename:\` — \`{ref, via, duration?}\` for the audio file.
  \`via.channel\` is how it was recorded (\`microphone\`), \`via.at\` when
  recording started; \`via.note\` may say how or why, in prose.
  \`duration\` is set after transcription.
- \`transcript:\` — full text transcription. Present means the clip
  is transcribed.
- \`transcription-error:\` — set if transcription failed.

If there is no \`transcript:\`, the audio hasn't been
transcribed yet — don't treat it as empty content. This usually means
the transcription provider was unavailable when the capture was
prepared (see the parent capture-session card's
\`transcription-failed:\` flag). You can retry it yourself: run
\`bbx chat retranscribe --file <path-to-the-attached-audio-file>\`,
and copy the printed transcript into \`transcript:\`. If the retry also
fails, record it in \`transcription-error:\` and note it in your
annotation instead of fabricating a transcript.`,
});

export type AudioFields = InferCardFields<typeof AudioSchema>;

export function createAudioTemplate(options: {
  via: MediaVia;
  filename: string;
}): string {
  const fields = {
    filename: {
      ref: `attach/${options.filename}`,
      via: options.via,
    },
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
