/**
 * Capture session card schema - groups images and audio from a capture session.
 *
 * Created by the capture connector. Contains references to all child
 * image and audio cards in the same directory.
 *
 * Later workflows transcribe audio, analyze images, and build a unified
 * transcript with inline image references.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const CaptureSessionStatus = z.enum(["new", "transcribing", "transcribed"]);
export type CaptureSessionStatus = z.infer<typeof CaptureSessionStatus>;

export const SessionTime = element("time", {
  attrs: {
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }).optional(),
    duration: z.string().optional(),
  },
});

export const SessionImageRef = element("image-ref", {
  attrs: {
    file: z.string(),
  },
});

export const SessionImages = element("images", {
  children: z.array(SessionImageRef).optional(),
});

export const SessionAudioRef = element("audio-ref", {
  attrs: {
    file: z.string(),
  },
});

export const SessionAudioClips = element("audio-clips", {
  children: z.array(SessionAudioRef).optional(),
});

export const SessionTranscript = element("transcript", {
  text: z.string().optional(),
});

/**
 * Capture session card schema.
 *
 * Example:
 * ```xml
 * <capture-session status="new" session-id="abc123">
 *   <time start="2024-01-15T10:00:00Z" end="2024-01-15T10:15:00Z" duration="15m0s" />
 *   <images>
 *     <image-ref file="photo-001.image.card" />
 *     <image-ref file="photo-002.image.card" />
 *   </images>
 *   <audio-clips>
 *     <audio-ref file="audio-001.audio.card" />
 *     <audio-ref file="audio-002.audio.card" />
 *   </audio-clips>
 *   <transcript></transcript>
 * </capture-session>
 * ```
 */
export const CaptureSessionSchema = element("capture-session", {
  attrs: {
    status: CaptureSessionStatus.default("new"),
    "session-id": z.string(),
  },
  children: z.array(
    z.union([
      SessionTime,
      SessionImages,
      SessionAudioClips,
      SessionTranscript,
    ])
  ),
  instructions: `# Handling Capture Sessions

A capture session groups images and audio from a single recording session. All child cards (image and audio) live in the same directory.

- **status="new"**: Just pulled, nothing processed yet.
- **status="transcribing"**: Audio transcription is in progress.
- **status="transcribed"**: All audio transcribed and unified transcript created.

The <images> and <audio-clips> containers hold references (relative file paths) to the child cards in this directory.

When processing a session:
1. First transcribe all audio clips (set each audio card to "transcribed").
2. Then analyze all images (set each image card to "analyzed" or "invalid").
3. Build a unified <transcript> that interleaves the audio transcriptions with inline <image-ref> markers showing where photos were taken relative to the audio timeline.
4. Set status to "transcribed".

The session-id attribute links back to the capture API for reference.`,
});

export type CaptureSession = z.infer<typeof CaptureSessionSchema>;

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

/**
 * Template for creating a capture session card.
 */
export function createCaptureSessionTemplate(options: {
  sessionId: string;
  startedAt: string;
  endedAt?: string | null;
  imageRefs: string[];
  audioRefs: string[];
}): string {
  const duration = options.endedAt
    ? formatDuration(new Date(options.endedAt).getTime() - new Date(options.startedAt).getTime())
    : undefined;

  const captureSession = (
    <capture-session status="new" session-id={options.sessionId}>
      <time start={options.startedAt} end={options.endedAt || undefined} duration={duration} />
      <images>
        {options.imageRefs.map((ref) => (
          <image-ref file={ref} />
        ))}
      </images>
      <audio-clips>
        {options.audioRefs.map((ref) => (
          <audio-ref file={ref} />
        ))}
      </audio-clips>
      <transcript></transcript>
    </capture-session>
  );

  return serialize(captureSession) + "\n";
}
