/**
 * Transcribe voice content pre-action.
 *
 * Looks for cards with audio attachments and transcribes them via OpenAI
 * Whisper. Works on memo and feedback cards (both frontmatter); the audio
 * attachment lives as a sibling file sharing the card's basename.
 *
 * `audio` was historically handled here too; that path is dead now —
 * capture-session audio is transcribed by the capture preparation worker
 * (src/core/capture/transcribe-clips.ts).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readAssetContent } from "../../lib/asset-content.js";
import { describeAbsentContent } from "../../lib/annex-pointer.js";
import type { PreAction, PreActionContext } from "./types.js";
import { transcribeAudio, type TranscriptionError } from "../transcription/index.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../card-io.js";

/** Audio file extensions we can transcribe. */
const AUDIO_EXTENSIONS = [".webm", ".mp3", ".m4a", ".wav", ".ogg", ".flac"];

interface TranscriptionFields {
  language: string;
  "transcribed-at": string;
  text: string;
}

interface TranscriptionErrorFields {
  permanent: boolean;
  code?: string;
  "attempted-at": string;
  message: string;
}

/** Structural shape of a `TranscriptionError` — permanent flag plus a message. */
interface TranscriptionErrorLike {
  permanent: boolean;
  code?: string;
  message: string;
}

/**
 * Real (non-cast) guard for `TranscriptionError` — `transcription/index.ts`
 * has an equivalent `isTranscriptionError` but doesn't export it, so this
 * duplicates the structural check locally rather than reaching for `as`.
 */
function isTranscriptionErrorShape(error: unknown): error is TranscriptionError {
  return error instanceof Error && isRecord(error) && typeof error.permanent === "boolean";
}

export const transcribePreAction: PreAction = {
  name: "transcribe-voice",
  appliesTo: ["memo", "feedback"],

  async shouldRun(ctx: PreActionContext): Promise<boolean> {
    const audioFile = await findAudioAttachment(ctx.cardPath);
    if (audioFile === null) return false;
    const fields = ctx.frontmatter.fields;
    if (fields["transcription"] !== undefined) return false;
    if (isPermanentError(fields["transcription-error"])) return false;
    return true;
  },

  async execute(ctx: PreActionContext) {
    const audioFile = await findAudioAttachment(ctx.cardPath);
    if (audioFile === null) {
      return { modified: false, error: "No audio attachment found" };
    }

    // Absent annexed audio is ~100 bytes of pointer text, not audio. Without
    // this it goes to the transcription provider and comes back as an opaque
    // provider error recorded on the card, with nothing pointing at the real
    // cause. Marked non-permanent: fetching the content makes it retryable.
    const audio = await readAssetContent(audioFile);
    if (!audio.ok) {
      const message = describeAbsentContent(audio.error.pointer, path.basename(audioFile));
      applyFrontmatterError(ctx.frontmatter.fields, {
        permanent: false,
        "attempted-at": getBoxTimeISO(ctx.boxRoot),
        message,
      });
      return { modified: true, error: message };
    }

    try {
      const audioBuffer = Buffer.from(audio.value);
      const filename = path.basename(audioFile);
      const existingContent = getFrontmatterContent(ctx.frontmatter.fields);
      const result = await transcribeAudio({
        audioBuffer,
        filename,
        ...(existingContent !== null && { prompt: existingContent }),
        boxRoot: ctx.boxRoot,
      });

      applyFrontmatterTranscription({
        fields: ctx.frontmatter.fields,
        text: result.text,
        language: result.language,
        boxRoot: ctx.boxRoot,
      });

      return {
        modified: true,
        message: `Transcribed ${String(Math.round(result.duration))}s of audio`,
      };
    } catch (error) {
      // The try block above isn't limited to transcribeAudio (which always
      // throws TranscriptionError) — fs.readFile/applyFrontmatterTranscription
      // could throw a plain Error too, so fall back to a non-permanent generic
      // entry rather than assuming the shape.
      const transcriptionError: TranscriptionErrorLike = isTranscriptionErrorShape(error)
        ? error
        : { permanent: false, message: errorMessage(error) };
      const attemptedAt = getBoxTimeISO(ctx.boxRoot);
      applyFrontmatterError(ctx.frontmatter.fields, {
        permanent: transcriptionError.permanent,
        ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
        "attempted-at": attemptedAt,
        message: transcriptionError.message,
      });
      return { modified: true, error: transcriptionError.message };
    }
  },
};

// ─── Audio attachment discovery ─────────────────────────────────────────────

async function findAudioAttachment(cardPath: string): Promise<string | null> {
  const dir = path.dirname(cardPath);
  const basename = path.basename(cardPath, ".card");
  const nameParts = basename.split(".");
  const name = nameParts.slice(0, -1).join(".") || basename;
  for (const ext of AUDIO_EXTENSIONS) {
    const audioPath = path.join(dir, name + ext);
    try {
      await fs.access(audioPath);
      return audioPath;
    } catch (_e) {
      // access() throwing just means this extension isn't present — try the next.
    }
  }
  return null;
}

// ─── Frontmatter (Phase 2) helpers ──────────────────────────────────────────

function isPermanentError(raw: unknown): boolean {
  return isRecord(raw) && raw["permanent"] === true;
}

function getFrontmatterContent(fields: Record<string, unknown>): string | null {
  if (typeof fields["body"] === "string" && fields["body"].trim() !== "") {
    return fields["body"];
  }
  return null;
}

function applyFrontmatterTranscription(input: {
  fields: Record<string, unknown>;
  text: string;
  language: string;
  boxRoot: string;
}): void {
  const { fields, text, language, boxRoot } = input;
  delete fields["transcription-error"];
  const entry: TranscriptionFields = {
    language,
    "transcribed-at": getBoxTimeISO(boxRoot),
    text,
  };
  fields["transcription"] = entry;
}

function applyFrontmatterError(
  fields: Record<string, unknown>,
  err: TranscriptionErrorFields,
): void {
  fields["transcription-error"] = err;
}
