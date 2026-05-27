/**
 * Speech tag parsing utilities for assistant TTS content.
 * Uses parseTags for robust attribute extraction.
 */

import { parseTags } from "./parseTags";
import { VOICE_MODELS, type VoiceModel } from "../../../schemas/personality";

export const VALID_VOICES = VOICE_MODELS;
export type TTSVoice = VoiceModel;

export function isTTSVoice(v: string): v is TTSVoice {
  return (VALID_VOICES as readonly string[]).includes(v);
}

export interface SpeechSegment {
  text: string;
  instructions?: string;
  emotion?: string;
  voice?: TTSVoice;
  overrideInstructions?: boolean;
  displayText: string;
  hasTextBefore: boolean;
}

/**
 * Parse all <speech> tags from assistant content.
 * Returns array of speech segments in order.
 */
export function parseAllSpeechTags(content: string): SpeechSegment[] {
  const tags = parseTags(content, ["speech", "instructions"]);
  const segments: SpeechSegment[] = [];

  // Track positions for hasTextBefore
  const speechStarts: number[] = [];
  const speechRegex = /<speech[\s>]/gi;
  let m;
  while ((m = speechRegex.exec(content)) !== null) {
    speechStarts.push(m.index);
  }

  let lastEnd = 0;
  let posIndex = 0;

  for (const tag of tags) {
    if (tag.type !== "speech") continue;

    const tagStart = speechStarts[posIndex] ?? 0;
    const textBefore = content.slice(lastEnd, tagStart);
    const hasTextBefore = textBefore.trim().length > 0;

    // Find end of this speech tag
    const closeIndex = content.indexOf("</speech>", tagStart);
    lastEnd = closeIndex !== -1 ? closeIndex + "</speech>".length : content.length;
    posIndex++;

    // Extract instructions from subTags. If multiple <instructions> blocks
    // appear inside one <speech>, keep only the last non-empty one — the
    // agent occasionally emits a leading instructions block and then a
    // second, more specific one for the same speech.
    let instructions: string | undefined;
    let text = tag.content;
    if (tag.subTags) {
      const instrTags = tag.subTags
        .filter((t) => t.type === "instructions")
        .map((t) => t.content.trim())
        .filter((c) => c.length > 0);
      if (instrTags.length > 0) {
        instructions = instrTags[instrTags.length - 1];
      }
      if (tag.subTags.some((t) => t.type === "instructions")) {
        text = text.replace(/<instructions>[\S\s]*?<\/instructions>/gi, "").trim();
      }
    }
    // Strip any orphan instructions open/close fragments (e.g. a stray extra
    // </instructions> the agent emitted alongside the real one, or a typo'd
    // close like </intructions>). Pattern matches `instructions`,
    // `intructions`, with optional trailing `s`. Without this strip the TTS
    // would speak the literal tag markup.
    text = text.replace(/<\/?in[a-z]*tructions?[^>]*>/gi, "").trim();

    // Validate voice attribute against known list
    let voice: TTSVoice | undefined;
    if (tag.attrs.voice) {
      const v = tag.attrs.voice.toLowerCase();
      if (isTTSVoice(v)) {
        voice = v;
      } else {
        console.warn(`[Speech] Unknown voice "${tag.attrs.voice}", using default`);
      }
    }

    const overrideInstructions = tag.attrs["override-instructions"] === "1";

    segments.push({
      text,
      instructions,
      emotion: tag.attrs.emotion || undefined,
      voice,
      overrideInstructions: overrideInstructions || undefined,
      displayText: text,
      hasTextBefore,
    });
  }

  return segments;
}

/**
 * Check if content contains speech tags.
 */
export function hasAssistantSpeech(content: string): boolean {
  return /<speech[\s>]/.test(content) && /<\/speech>/i.test(content);
}
