/**
 * Audio card schema — audio clips from capture sessions.
 *
 * Created by the capture connector. Processed by `cb transcribe-captures`
 * which fills in transcript + summary and sets duration on the filename.
 *
 * Layout: `audio-001.audio.card` next to `audio-001.attach/audio-001.webm`.
 * Word-level timing data lives alongside as
 * `audio-001.attach/audio-001.timing.json`.
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const AudioStatus = z.enum(["new", "transcribed"]);
export type AudioStatus = z.infer<typeof AudioStatus>;

const FilenameEntry = z.object({
  ref: z.string(),
  recorded: z.string().datetime({ offset: true }),
  source: z.string(),
  duration: z.string().optional(),
});

const TranscriptionError = z.object({
  permanent: z.boolean(),
  code: z.string().optional(),
  "attempted-at": z.string().datetime({ offset: true }).optional(),
  message: z.string(),
});

export const AudioSchema: CardSchema = cardSchema("audio", {
  fields: {
    status: AudioStatus.default("new"),
    filename: FilenameEntry,
    summary: z.string().optional(),
    transcript: z.string().optional(),
    "transcription-error": TranscriptionError.optional(),
  },
  instructions: `# Audio Cards

An audio card represents a chunk of recorded speech from a capture
session. The attached audio file lives in the card's attach scope
(e.g. \`audio-001.audio.card\` with \`audio-001.attach/audio-001.webm\`);
\`filename.ref:\` points into that scope via the \`attach/\` prefix.

Frontmatter:
- \`filename:\` — \`{ref, recorded, source, duration?}\` for the audio
  file. \`duration\` is set after transcription.
- \`summary:\` — brief summary of what was said (filled during
  transcription).
- \`transcript:\` — full text transcription (added during
  transcription, absent when new).
- \`transcription-error:\` — set if transcription failed.

Status: new (not yet transcribed, no \`transcript\`/\`summary\`) →
transcribed (transcription complete).

If status is "new" with no \`transcript:\`, the audio hasn't been
transcribed yet — don't treat it as empty content.`,
});

export interface AudioFields {
  type: "audio";
  status: AudioStatus;
  filename: {
    ref: string;
    recorded: string;
    source: string;
    duration?: string;
  };
  summary?: string;
  transcript?: string;
  "transcription-error"?: {
    permanent: boolean;
    code?: string;
    "attempted-at"?: string;
    message: string;
  };
}

export function createAudioTemplate(options: {
  recordedAt: string;
  source: string;
  filename: string;
}): string {
  const fields = {
    status: "new",
    filename: {
      ref: `attach/${options.filename}`,
      recorded: options.recordedAt,
      source: options.source,
    },
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
