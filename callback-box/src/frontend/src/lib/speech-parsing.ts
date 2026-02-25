/**
 * Speech tag parsing utilities for assistant TTS content.
 * Adapted from thinking-machine speechParsing.ts.
 */

export interface SpeechSegment {
  text: string;
  instructions?: string;
  emotion?: string;
  displayText: string;
  hasTextBefore: boolean;
}

/**
 * Parse all <speech> tags from assistant content.
 * Returns array of speech segments in order.
 */
export function parseAllSpeechTags(content: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  const regex =
    /<speech(?:\s+emotion="([^"]*)")?\s*>([\S\s]*?)<\/speech>/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const emotion = match[1];
    const speechContent = match[2] ?? "";

    const textBefore = content.slice(lastIndex, match.index);
    const hasTextBefore = textBefore.trim().length > 0;

    const instructionsMatch = speechContent.match(
      /<instructions>([\S\s]*?)<\/instructions>/i
    );

    let text: string;
    let instructions: string | undefined;

    if (instructionsMatch?.[1]) {
      instructions = instructionsMatch[1].trim();
      text = speechContent
        .replace(/<instructions>[\S\s]*?<\/instructions>/i, "")
        .trim();
    } else {
      text = speechContent.trim();
    }

    segments.push({ text, instructions, emotion, displayText: text, hasTextBefore });
    lastIndex = match.index + match[0].length;
  }

  return segments;
}

/**
 * Check if content contains speech tags.
 */
export function hasAssistantSpeech(content: string): boolean {
  return /<speech(?:\s[^>]*)?>/.test(content) && /<\/speech>/i.test(content);
}
