/**
 * Speech tag parsing utilities for assistant TTS content.
 * Uses parseTags for robust attribute extraction.
 */

import { parseTags } from "../parseTags";
import { VOICE_MODELS, type VoiceModel } from "../../../../schemas/personality";

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
  /** Optional speaker label (the `name` attribute), shown on the chunk. */
  name?: string;
  displayText: string;
  hasTextBefore: boolean;
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
}

// Markdoc `{% redacted %}…{% /redacted %}` spans render as hidden-until-tap in
// the chat, so they must not be spoken. An unclosed open tag hides through the
// end of the text — dropping just the marker would leak the hidden content.
const REDACTED_SPAN = /{%\s*redacted\s*%}[\S\s]*?(?:{%\s*\/redacted\s*%}|$)/gi;
const REDACTED_STRAY_CLOSE = /{%\s*\/redacted\s*%}/gi;

function stripRedacted(text: string): string {
  return text.replace(REDACTED_SPAN, "").replace(REDACTED_STRAY_CLOSE, "").trim();
}

// The agent occasionally misspells the nested instructions tag (e.g.
// `<intructions>`, dropping the second "s"). Canonicalize any such open/close
// tag to `<instructions>` *before* parsing, so the exact-name extraction below
// recognizes it — recovering the direction AND keeping its prose out of the
// spoken text, instead of leaking it as content. Matches `in<anything>truction`
// with an optional plural `s`, and preserves attributes. `<speech>` markers are
// untouched, so downstream position tracking stays aligned.
const INSTRUCTIONS_TAG_TYPO = /<(\/?)in[a-z]*tructions?((?:\s[^>]*)?)>/gi;

function normalizeInstructionTags(content: string): string {
  return content.replace(INSTRUCTIONS_TAG_TYPO, "<$1instructions$2>");
}

/**
 * Parse all <speech> tags from assistant content.
 * Returns array of speech segments in order.
 */
export function parseAllSpeechTags(content: string): SpeechSegment[] {
  const norm = normalizeInstructionTags(content);
  const tags = parseTags(norm, ["speech", "instructions"]);
  const segments: SpeechSegment[] = [];

  // Track positions for hasTextBefore
  const speechStarts: number[] = [];
  const speechRegex = /<speech[\s>]/gi;
  let m;
  while ((m = speechRegex.exec(norm)) !== null) {
    speechStarts.push(m.index);
  }

  let lastEnd = 0;
  let posIndex = 0;

  for (const tag of tags) {
    if (tag.type !== "speech") continue;

    const tagStart = speechStarts[posIndex] ?? 0;
    const textBefore = norm.slice(lastEnd, tagStart);
    const hasTextBefore = textBefore.trim().length > 0;

    // Find end of this speech tag
    const closeIndex = norm.indexOf("</speech>", tagStart);
    lastEnd = closeIndex !== -1 ? closeIndex + "</speech>".length : norm.length;
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
    // Safety net for orphan instruction fragments left in the spoken text — a
    // stray `</instructions>` with no matching open, or an open whose pair the
    // tag parser didn't form. Typo'd tags were already canonicalized upstream
    // (normalizeInstructionTags), so this only needs the canonical spelling.
    text = text.replace(/<\/?instructions[^>]*>/gi, "").trim();

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
    const name = tag.attrs.name ? unescapeAttr(tag.attrs.name) : undefined;

    segments.push({
      text: stripRedacted(text),
      instructions,
      emotion: tag.attrs.emotion || undefined,
      voice,
      overrideInstructions: overrideInstructions || undefined,
      name,
      displayText: text,
      hasTextBefore,
    });
  }

  return segments;
}

export type SpeechPart =
  | { type: "text"; text: string }
  | { type: "speech"; segment: SpeechSegment; index: number };

/**
 * Split assistant content into an ordered sequence of spoken and non-spoken
 * parts, so each `<speech>` chunk can be rendered as its own element (e.g.
 * for the now-playing highlight). Speech parts carry their absolute index
 * within the content — matching parseAllSpeechTags order, which is what the
 * playback machine reports as the currently-playing index.
 */
export function splitSpeechParts(content: string): SpeechPart[] {
  const segments = parseAllSpeechTags(content);
  if (segments.length === 0) {
    return content.trim().length > 0 ? [{ type: "text", text: content }] : [];
  }

  const starts: number[] = [];
  const speechRegex = /<speech[\s>]/gi;
  let m;
  while ((m = speechRegex.exec(content)) !== null) starts.push(m.index);

  const parts: SpeechPart[] = [];
  let cursor = 0;
  let segIndex = 0;
  for (const start of starts) {
    // `.at()`, not `segments[segIndex]`: `starts` comes from a separate regex
    // scan and can genuinely diverge in count from `segments` (parsed by
    // parseAllSpeechTags) on malformed/unclosed tags, so this index can run
    // past the end of `segments`.
    const segment = segments.at(segIndex);
    if (segment === undefined) break;
    if (start > cursor) {
      const between = content.slice(cursor, start);
      if (between.trim().length > 0) parts.push({ type: "text", text: between });
    }
    const closeIndex = content.indexOf("</speech>", start);
    cursor = closeIndex !== -1 ? closeIndex + "</speech>".length : content.length;
    parts.push({ type: "speech", segment, index: segIndex });
    segIndex++;
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor);
    if (tail.trim().length > 0) parts.push({ type: "text", text: tail });
  }
  return parts;
}

/**
 * Check if content contains speech tags.
 */
export function hasAssistantSpeech(content: string): boolean {
  return /<speech[\s>]/.test(content) && /<\/speech>/i.test(content);
}
