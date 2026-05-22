/**
 * Transcribe voice content pre-action.
 *
 * Looks for cards with audio attachments and transcribes them via OpenAI
 * Whisper. Works on memo (Phase 2 frontmatter) and feedback (still
 * XML); the audio attachment lives as a sibling file sharing the card's
 * basename.
 *
 * `audio` was historically handled here too; that path is dead now —
 * capture-session audio is transcribed by `cb transcribe-captures`
 * which uses the per-audio-card attach scope.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PreAction, PreActionContext } from "./types.js";
import { transcribeAudio, type TranscriptionError } from "../transcription.js";
import type { ElementNode } from "cardworks";

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
    if ("frontmatter" in ctx) {
      const fields = ctx.frontmatter.fields;
      if (fields["transcription"] !== undefined) return false;
      if (isPermanentError(fields["transcription-error"])) return false;
      return true;
    }
    const element = ctx.xml.card.element;
    if (hasXmlTranscription(element)) return false;
    if (hasXmlPermanentError(element)) return false;
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
      const existingContent = "frontmatter" in ctx
        ? getFrontmatterContent(ctx.frontmatter.fields)
        : getXmlContent(ctx.xml.card.element);
      const result = await transcribeAudio({
        audioBuffer,
        filename,
        ...(existingContent !== null && { prompt: existingContent }),
        boxRoot: ctx.boxRoot,
      });

      if ("frontmatter" in ctx) {
        applyFrontmatterTranscription({ fields: ctx.frontmatter.fields, text: result.text, language: result.language });
      } else {
        applyXmlTranscription({ element: ctx.xml.card.element, text: result.text, language: result.language });
      }

      return {
        modified: true,
        message: `Transcribed ${String(Math.round(result.duration))}s of audio`,
      };
    } catch (error) {
      const transcriptionError = error as TranscriptionError;
      const attemptedAt = new Date().toISOString();
      if ("frontmatter" in ctx) {
        applyFrontmatterError(ctx.frontmatter.fields, {
          permanent: transcriptionError.permanent,
          ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
          "attempted-at": attemptedAt,
          message: transcriptionError.message,
        });
      } else {
        applyXmlError(ctx.xml.card.element, {
          permanent: transcriptionError.permanent,
          ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
          attemptedAt,
          message: transcriptionError.message,
        });
      }
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
    } catch {
      // try next extension
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
}): void {
  const { fields, text, language } = input;
  delete fields["transcription-error"];
  const entry: TranscriptionFields = {
    language,
    "transcribed-at": new Date().toISOString(),
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

// ─── XML (Phase 1) helpers ──────────────────────────────────────────────────

function hasXmlTranscription(element: ElementNode): boolean {
  const children = element.children;
  return children.some((c) => c.tagName === "transcription");
}

function hasXmlPermanentError(element: ElementNode): boolean {
  const errEl = element.children.find((c) => c.tagName === "transcription-error");
  return errEl !== undefined && errEl.attrs["permanent"] === "true";
}

function getXmlContent(element: ElementNode): string | null {
  const contentEl = element.children.find((c) => c.tagName === "content");
  return contentEl?.text === undefined || contentEl.text === "" ? null : contentEl.text;
}

function applyXmlTranscription(input: {
  element: ElementNode;
  text: string;
  language: string;
}): void {
  const { element, text, language } = input;
  const children = element.children;
  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
  if (errorIndex !== -1) {
    children.splice(errorIndex, 1);
  }
  children.push({
    tagName: "transcription",
    attrs: { language, "transcribed-at": new Date().toISOString() },
    children: [],
    text,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  });
  element.dirty = true;
}

function applyXmlError(
  element: ElementNode,
  err: { permanent: boolean; code?: string; attemptedAt: string; message: string },
): void {
  const children = element.children;
  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
  if (errorIndex !== -1) {
    children.splice(errorIndex, 1);
  }
  const attrs: Record<string, string> = {
    permanent: err.permanent ? "true" : "false",
    code: err.code ?? "unknown",
    "attempted-at": err.attemptedAt,
  };
  children.push({
    tagName: "transcription-error",
    attrs,
    children: [],
    text: err.message,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  });
  element.dirty = true;
}
