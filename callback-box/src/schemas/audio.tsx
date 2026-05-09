/** @jsxImportSource cardworks/jsx */
/**
 * Audio card schema - audio clips from capture sessions.
 *
 * Created by the capture connector when pulling sessions.
 * Processed by the agent to add transcripts.
 *
 * Transcript timing data goes in a separate file alongside the audio:
 * e.g. audio-001.timing.json next to audio-001.webm and audio-001.audio.card
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const AudioStatus = z.enum(["new", "transcribed"]);
export type AudioStatus = z.infer<typeof AudioStatus>;

export const AudioFilename = element("filename", {
  attrs: {
    ref: z.string(),
    recorded: z.string().datetime({ offset: true }),
    source: z.string(),
    duration: z.string().optional(),
  },
});

export const AudioSummary = element("summary", {
  text: z.string().optional(),
});

export const AudioTranscript = element("transcript", {
  text: z.string().optional(),
});

/**
 * Child element for transcription error (added when transcription fails).
 */
export const AudioTranscriptionError = element("transcription-error", {
  attrs: {
    permanent: z.enum(["true", "false"]),
    code: z.string().optional(),
    "attempted-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Audio card schema.
 *
 * Example:
 * ```xml
 * <audio status="new">
 * <filename ref="audio-001.webm" recorded="2024-01-15T10:00:00Z" source="microphone" />
 * <summary></summary>
 * <transcript></transcript>
 * </audio>
 * ```
 */
export const AudioSchema = element("audio", {
  attrs: {
    status: AudioStatus.default("new"),
  },
  children: z.array(
    z.union([
      AudioFilename,
      AudioSummary,
      AudioTranscript,
      AudioTranscriptionError,
    ])
  ),
  instructions: `# Audio Cards

An audio card represents a chunk of recorded speech from a capture session. The attached audio file shares the card's basename (e.g. \`audio-001.webm\` alongside \`audio-001.audio.card\`).

Elements:
- \`<filename>\` — the attached audio file
- \`<transcript>\` — full text transcription (added during transcription, absent when new)
- \`<summary>\` — brief summary of what was said (added during transcription)

Status: new (not yet transcribed, no \`<transcript>\` or \`<summary>\`) → transcribed (transcription complete).

If status is "new" with no \`<transcript>\`, the audio hasn't been transcribed yet — don't treat it as empty content.`,
});

export type Audio = z.infer<typeof AudioSchema>;

/**
 * Template for creating an audio card.
 */
export function createAudioTemplate(options: {
  recordedAt: string;
  source: string;
  filename: string;
}): string {
  const audio = (
    <audio status="new">
      <filename ref={options.filename} recorded={options.recordedAt} source={options.source} />
    </audio>
  );

  return serialize(audio) + "\n";
}
