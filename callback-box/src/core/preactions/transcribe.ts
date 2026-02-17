/**
 * Transcribe voice content pre-action.
 *
 * Looks for cards with audio attachments and transcribes them
 * using OpenAI Whisper API.
 *
 * Works with any card type that:
 * - Has an audio attachment (shares basename with card)
 * - Uses <source>voice</source> to indicate voice input
 * - Uses <transcription> and <transcription-error> elements
 *
 * Currently supports: memo, feedback
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PreAction, PreActionContext, PreActionResult } from "./index.js";
import { transcribeAudio, type TranscriptionError } from "../transcription.js";
import type { ElementNode } from "cardworks";

/** Audio file extensions we can transcribe */
const AUDIO_EXTENSIONS = [".webm", ".mp3", ".m4a", ".wav", ".ogg", ".flac"];

export const transcribePreAction: PreAction = {
  name: "transcribe-voice",
  appliesTo: ["memo", "feedback", "audio"],

  async shouldRun(context: PreActionContext): Promise<boolean> {
    const { card, cardPath } = context;
    const element = card.element;
    const isAudioCard = element.tagName === "audio";

    // Check if it's a voice memo (has audio attachment)
    const audioFile = await findAudioAttachment(cardPath);
    if (!audioFile) {
      return false;
    }

    // Check if already transcribed
    if (isAudioCard ? hasTranscript(element) : hasTranscription(element)) {
      return false;
    }

    // Check if there's a permanent error
    if (hasPermanentError(element)) {
      return false;
    }

    return true;
  },

  async execute(context: PreActionContext): Promise<PreActionResult> {
    const { card, cardPath } = context;
    const element = card.element;
    const isAudioCard = element.tagName === "audio";

    // Find the audio file
    const audioFile = await findAudioAttachment(cardPath);
    if (!audioFile) {
      return { modified: false, error: "No audio attachment found" };
    }

    try {
      // Read the audio file
      const audioBuffer = await fs.readFile(audioFile);
      const filename = path.basename(audioFile);

      // Get any existing content for context
      const existingContent = getExistingContent(element);
      // Transcribe
      const result = await transcribeAudio({
        audioBuffer,
        filename,
        ...(existingContent && { prompt: existingContent }),
      });

      // Add transcription to the card
      if (isAudioCard) {
        addTranscript({ element, text: result.text });
      } else {
        addTranscription({ element, text: result.text, language: result.language });
      }

      return {
        modified: true,
        message: `Transcribed ${Math.round(result.duration)}s of audio`,
      };
    } catch (error) {
      const transcriptionError = error as TranscriptionError;

      // Record the error in the card
      addTranscriptionError({
        element,
        message: transcriptionError.message,
        permanent: transcriptionError.permanent,
        ...(transcriptionError.code && { code: transcriptionError.code }),
      });

      return {
        modified: true, // We modified the card to add the error
        error: transcriptionError.message,
      };
    }
  },
};

/**
 * Find an audio attachment for a card.
 * Attachments share the same basename as the card.
 */
async function findAudioAttachment(cardPath: string): Promise<string | null> {
  const dir = path.dirname(cardPath);
  const basename = path.basename(cardPath, ".card");
  // Remove the .type part too (e.g., "Voice_Memo.memo" -> "Voice_Memo")
  const nameParts = basename.split(".");
  const name = nameParts.slice(0, -1).join(".") || basename;

  for (const ext of AUDIO_EXTENSIONS) {
    const audioPath = path.join(dir, name + ext);
    try {
      await fs.access(audioPath);
      return audioPath;
    } catch {
      // File doesn't exist, try next extension
    }
  }

  return null;
}

/**
 * Check if the memo already has a transcription.
 */
function hasTranscription(element: ElementNode): boolean {
  const children = element.children as ElementNode[];
  return children.some((c) => c.tagName === "transcription");
}

/**
 * Check if an audio card already has a non-empty transcript.
 */
function hasTranscript(element: ElementNode): boolean {
  const children = element.children as ElementNode[];
  const transcript = children.find((c) => c.tagName === "transcript");
  if (!transcript) return false;
  // Empty <transcript/> doesn't count — that's an untranscribed card from the old template
  return Boolean(transcript.text?.trim());
}

/**
 * Check if the memo has a permanent transcription error.
 */
function hasPermanentError(element: ElementNode): boolean {
  const children = element.children as ElementNode[];
  const errorEl = children.find((c) => c.tagName === "transcription-error");
  if (!errorEl) {
    return false;
  }
  return errorEl.attrs["permanent"] === "true";
}

/**
 * Get existing content from the memo for context.
 */
function getExistingContent(element: ElementNode): string | null {
  const children = element.children as ElementNode[];
  const contentEl = children.find((c) => c.tagName === "content");
  return contentEl?.text ?? null;
}

/**
 * Parameters for addTranscription
 */
interface AddTranscriptionParams {
  element: ElementNode;
  text: string;
  language: string;
}

/**
 * Add transcription to a memo element.
 */
function addTranscription(params: AddTranscriptionParams): void {
  const { element, text, language } = params;
  const children = element.children as ElementNode[];

  // Remove any previous transcription error
  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
  if (errorIndex !== -1) {
    children.splice(errorIndex, 1);
  }

  // Add transcription element
  const transcriptionEl: ElementNode = {
    tagName: "transcription",
    attrs: {
      language,
      "transcribed-at": new Date().toISOString(),
    },
    children: [],
    text,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };

  children.push(transcriptionEl);
}

/**
 * Add transcript to an audio card element and set status to transcribed.
 */
function addTranscript(params: { element: ElementNode; text: string }): void {
  const { element, text } = params;
  const children = element.children as ElementNode[];

  // Add transcript element
  const transcriptEl: ElementNode = {
    tagName: "transcript",
    attrs: {},
    children: [],
    text,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };

  children.push(transcriptEl);

  // Set status to transcribed
  element.attrs["status"] = "transcribed";
  element.dirty = true;
}

/**
 * Parameters for addTranscriptionError
 */
interface AddTranscriptionErrorParams {
  element: ElementNode;
  message: string;
  permanent: boolean;
  code?: string;
}

/**
 * Add a transcription error to a memo element.
 */
function addTranscriptionError(params: AddTranscriptionErrorParams): void {
  const { element, message, permanent, code } = params;
  const children = element.children as ElementNode[];

  // Remove any previous error
  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
  if (errorIndex !== -1) {
    children.splice(errorIndex, 1);
  }

  // Add error element
  const errorEl: ElementNode = {
    tagName: "transcription-error",
    attrs: {
      permanent: permanent ? "true" : "false",
      code: code ?? "unknown",
      "attempted-at": new Date().toISOString(),
    },
    children: [],
    text: message,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };

  children.push(errorEl);
}
