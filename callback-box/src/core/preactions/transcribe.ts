/**
 * Transcribe voice content pre-action.
 *
 * Looks for cards with audio attachments and transcribes them via OpenAI
 * Whisper. Works on memo and feedback cards (both frontmatter); the audio
 * attachment lives as a sibling file sharing the card's basename.
 *
 * `audio` was historically handled here too; that path is dead now —
 * capture-session audio is transcribed by `cb transcribe-captures`
 * which uses the per-audio-card attach scope.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PreAction, PreActionContext } from "./types.js";
import { transcribeAudio, type TranscriptionError } from "../transcription/index.js";
import { getBoxTimeISO } from "../../lib/time.js";

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

    try {
      const audioBuffer = await fs.readFile(audioFile);
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
      const transcriptionError = error as TranscriptionError;
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
  if (raw === null || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  return e["permanent"] === true;
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
