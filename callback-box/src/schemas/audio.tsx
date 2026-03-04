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
    name: z.string(),
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
 * Audio card schema.
 *
 * Example:
 * ```xml
 * <audio status="new">
 *   <filename name="audio-001.webm" recorded="2024-01-15T10:00:00Z" source="microphone" />
 *   <summary></summary>
 *   <transcript></transcript>
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
    ])
  ),
  instructions: `# Handling Audio Clips

Audio clips are chunks from continuous recording in capture sessions. Each audio card has an attached audio file (same basename, e.g. audio-001.webm alongside audio-001.audio.card).

- **status="new"**: Just pulled from capture, needs transcription. Will NOT have <transcript> or <summary> elements yet — these are added during transcription.
- **status="transcribed"**: Has been transcribed. Will have <transcript> and <summary> elements.

If you see status="new" with no <transcript> element, the audio has NOT been transcribed yet. Do not treat it as empty — it needs to be transcribed first.`,
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
      <filename name={options.filename} recorded={options.recordedAt} source={options.source} />
    </audio>
  );

  return serialize(audio) + "\n";
}
