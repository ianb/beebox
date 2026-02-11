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

- **status="new"**: Just pulled from capture, not yet transcribed.
- **status="transcribed"**: Transcript, summary, and duration have been filled in.

When transcribing:
1. Transcribe the attached audio file.
2. Fill in <transcript> with the full text.
3. Fill in <summary> with a one-sentence description of what's in the audio.
4. Set the duration attribute on <filename> (in seconds).
5. Optionally create a timing file (e.g. audio-001.timing.json) with word-level timestamps.
6. Set status to "transcribed".`,
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
      <summary></summary>
      <transcript></transcript>
    </audio>
  );

  return serialize(audio) + "\n";
}
