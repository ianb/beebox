/** @jsxImportSource cardworks/jsx */
/**
 * Capture session card schema - groups images and audio from a capture session.
 *
 * Created by the capture connector. Contains references to all child
 * image and audio cards in the same directory.
 *
 * Later procedures transcribe audio, analyze images, and build a unified
 * transcript with inline image references.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const CaptureSessionStatus = z.enum(["new", "transcribing", "transcribed", "intake-complete", "extracted"]);
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
    ref: z.string(),
  },
});

export const SessionImages = element("images", {
  children: z.array(SessionImageRef).optional(),
});

export const SessionAudioRef = element("audio-ref", {
  attrs: {
    ref: z.string(),
  },
});

export const SessionAudioClips = element("audio-clips", {
  children: z.array(SessionAudioRef).optional(),
});

export const SessionFileRef = element("file-ref", {
  attrs: {
    ref: z.string(),
  },
});

export const SessionFiles = element("files", {
  children: z.array(SessionFileRef).optional(),
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
 * <time start="2024-01-15T10:00:00Z" end="2024-01-15T10:15:00Z" duration="15m0s" />
 * <images>
 * <image-ref ref="attach/photo-001-whiteboard.image.card" />
 * <image-ref ref="attach/photo-002-diagram.image.card" />
 * </images>
 * <audio-clips>
 * <audio-ref ref="attach/audio-001.audio.card" />
 * </audio-clips>
 * <transcript>
 * <text>So let me walk through the timeline we've got here...</text>
 * <image ref="attach/photo-001-whiteboard.image.card" description="Whiteboard with Q2 milestones" filename="photo-001-whiteboard.jpg" />
 * <text>And then phase two starts in March.</text>
 * <silence duration="15s" />
 * <text>OK let me get a photo of this diagram too.</text>
 * <image ref="attach/photo-002-diagram.image.card" description="Architecture diagram" filename="photo-002-diagram.jpg" />
 * </transcript>
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
      SessionFiles,
      SessionPurpose,
      SessionTranscript,
    ])
  ),
  instructions: `# Capture Session Cards

A capture session groups images, audio clips, and uploaded files from a single recording session (e.g., a voice walkthrough with photos, or a batch of documents). The session card lives at the inbox level; its child cards (audio, image, file) live inside the session's attach scope (\`{basename}.attach/\`). Refs to children use the \`attach/\` virtual prefix.

Elements:
- \`<images>\` — contains \`<image ref="...">\` references to child image cards
- \`<audio-clips>\` — contains \`<audio ref="...">\` references to child audio cards
- \`<files>\` — contains \`<file-ref ref="...">\` references to child file cards (uploaded documents, PDFs, etc.)
- \`<purpose>\` — optional one-sentence statement of what the user was doing (legacy, no longer generated)
- \`<transcript>\` — structured timeline combining speech and photos:
  - \`<text>\` — transcribed speech segments
  - \`<silence duration="Ns" />\` — gaps of 10+ seconds
  - \`<image ref="..." description="..." filename="..." />\` — where a photo was taken in the timeline

The \`session-id\` attribute links back to the capture API.

Status: new → transcribing → transcribed (audio done, ready for processing) → intake-complete (images described, timeline assembled) → extracted (records pulled into a catalog directory).`,
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
 *
 * `imageRefs`, `audioRefs`, `fileRefs` are bare child-card filenames
 * (e.g. `photo-001.image.card`). The template emits them with the
 * `attach/` virtual prefix, pointing into the session's attach scope.
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

  const fileRefs = options.fileRefs ?? [];

  const captureSession = (
    <capture-session status="new" session-id={options.sessionId}>
      <time start={options.startedAt} end={options.endedAt || undefined} duration={duration} />
      <images>
        {options.imageRefs.map((ref) => (
          <image-ref ref={`attach/${ref}`} />
        ))}
      </images>
      <audio-clips>
        {options.audioRefs.map((ref) => (
          <audio-ref ref={`attach/${ref}`} />
        ))}
      </audio-clips>
      {fileRefs.length > 0 ? (
        <files>
          {fileRefs.map((ref) => (
            <file-ref ref={`attach/${ref}`} />
          ))}
        </files>
      ) : null}
      <transcript></transcript>
    </capture-session>
  );

  return serialize(captureSession) + "\n";
}
