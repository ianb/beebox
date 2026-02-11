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

export const CaptureSessionStatus = z.enum(["new", "transcribing", "transcribed", "intake-complete"]);
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

export const SessionPurpose = element("purpose", {
  text: z.string().optional(),
});

export const TranscriptText = element("text", {
  text: z.string().optional(),
});

export const TranscriptSilence = element("silence", {
  attrs: {
    duration: z.string(),
  },
});

export const TranscriptImage = element("image", {
  attrs: {
    ref: z.string(),
    description: z.string().optional(),
    filename: z.string().optional(),
  },
});

export const SessionTranscript = element("transcript", {
  children: z.array(
    z.union([TranscriptText, TranscriptSilence, TranscriptImage])
  ).optional(),
});

/**
 * Capture session card schema.
 *
 * Example:
 * ```xml
 * <capture-session status="intake-complete" session-id="abc123">
 *   <time start="2024-01-15T10:00:00Z" end="2024-01-15T10:15:00Z" duration="15m0s" />
 *   <images>
 *     <image-ref file="photo-001-whiteboard.image.card" />
 *     <image-ref file="photo-002-diagram.image.card" />
 *   </images>
 *   <audio-clips>
 *     <audio-ref file="audio-001.audio.card" />
 *   </audio-clips>
 *   <purpose>User is planning the Q2 project timeline and capturing whiteboard notes</purpose>
 *   <transcript>
 *     <text>So let me walk through the timeline we've got here...</text>
 *     <image ref="photo-001-whiteboard.image.card" description="Whiteboard with Q2 milestones" filename="photo-001-whiteboard.jpg" />
 *     <text>And then phase two starts in March.</text>
 *     <silence duration="15s" />
 *     <text>OK let me get a photo of this diagram too.</text>
 *     <image ref="photo-002-diagram.image.card" description="Architecture diagram" filename="photo-002-diagram.jpg" />
 *   </transcript>
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
      SessionPurpose,
      SessionTranscript,
    ])
  ),
  instructions: `# Handling Capture Sessions

A capture session groups images and audio from a single recording session. All child cards (image and audio) live in the same directory.

- **status="new"**: Just pulled, nothing processed yet.
- **status="transcribing"**: Audio transcription is in progress.
- **status="transcribed"**: All audio transcribed, ready for further processing.
- **status="intake-complete"**: Fully processed — purpose established, images described, timeline assembled.

The <images> and <audio-clips> containers hold references (relative file paths) to the child cards in this directory.

## Elements

- **<purpose>**: One-sentence statement of what the user is trying to do in this session. Written by synthesizing audio summaries.
- **<transcript>**: Structured timeline with children:
  - \`<text>\`: Transcribed speech segments (no timestamps in text).
  - \`<silence duration="Ns" />\`: Gaps of 10+ seconds between speech.
  - \`<image ref="..." description="..." filename="..." />\`: Where a photo was taken in the timeline.

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
      <purpose></purpose>
      <transcript></transcript>
    </capture-session>
  );

  return serialize(captureSession) + "\n";
}
