/**
 * Speech tag parsing utilities for assistant TTS content.
 * Uses parseTags for robust attribute extraction.
 */

import { parseTags } from "./parseTags";

export const VALID_VOICES = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse",
] as const;
export type TTSVoice = typeof VALID_VOICES[number];

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

    // Extract instructions from subTags
    let instructions: string | undefined;
    let text = tag.content;
    if (tag.subTags) {
      const instrTag = tag.subTags.find((t) => t.type === "instructions");
      if (instrTag) {
        instructions = instrTag.content.trim() || undefined;
        text = text.replace(/<instructions>[\S\s]*?<\/instructions>/i, "").trim();
      }
    }
    text = text.trim();

    // Validate voice attribute against known list
    let voice: TTSVoice | undefined;
    if (tag.attrs.voice) {
      const v = tag.attrs.voice.toLowerCase();
      if ((VALID_VOICES as readonly string[]).includes(v)) {
        voice = v as TTSVoice;
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
