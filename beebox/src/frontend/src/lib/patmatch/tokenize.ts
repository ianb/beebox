import { LIVE_GAP_MARKER } from "../audio/live-gap-marker";
import { BadTagError, BadWordError } from "./errors";

export function tokenizePattern(
  src: string
): (string | Record<string, string>)[] {
  const tagRe = /^\[([^\]=]+)=([^\]]+)\]/gu;
  const re = /^\n|\(|\)|\||\?|\s+|[^()|?[\]=\s]+/gu;
  const list: (string | Record<string, string>)[] = [];
  let remaining = src;
  while (remaining) {
    const tagMatch = tagRe.exec(remaining);
    if (tagMatch) {
      // Both groups always participate on a successful match — the pattern
      // has no optional/alternated group — so the fallbacks are unreachable
      // in practice but honest to the regex-match type.
      const name = tagMatch[1] ?? "";
      const value = tagMatch[2] ?? "";
      list.push({ [name]: value });
      remaining = remaining.slice(tagMatch[0].length);
      continue;
    }
    if (remaining.startsWith("[")) {
      throw new BadTagError(src, remaining);
    }
    const match = remaining.match(re);
    if (match) {
      if (match[0].trim() || match[0] === "\n") {
        list.push(match[0]);
      }
      remaining = remaining.slice(match[0].length);
      continue;
    }
    throw new BadWordError(src, remaining);
  }
  return list;
}

export function normalizeWord(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFKD") // Decompose characters with diacritics
    .replace(/[̀-ͯ]/g, "") // Remove diacritics
    .replace(/[^\da-z]/g, ""); // Remove any remaining non-alphanumeric characters
}

// Symmetric plural-tolerant equality so "message" matches "messages",
// "box" matches "boxes", and "party" matches "parties". Words are assumed
// already normalized.
export function wordsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length > b.length) {
    [a, b] = [b, a];
  }
  if (a.length < 2) return false;
  if (b === a + "s") return true;
  if (b === a + "es") return true;
  if (a.endsWith("y") && b === a.slice(0, -1) + "ies") return true;
  return false;
}

export interface InputWord {
  normalized: string;
  original: string;
  trailing: string;
  leading: string;
}

/**
 * Tokenize input text. A live gap marker (`docs/implemented-plans/live-gap-marker.md`)
 * becomes a word of its own that no pattern word matches, so a phrase never
 * matches across words the live transcript missed. Its surroundings
 * tokenize as usual, and joining every word still gives back the text.
 */
export function tokenizeInput(text: string): InputWord[] {
  if (!text.includes(LIVE_GAP_MARKER)) return tokenizeWords(text);
  const result: InputWord[] = [];
  for (const [index, part] of text.split(LIVE_GAP_MARKER).entries()) {
    if (index > 0) result.push({ normalized: LIVE_GAP_MARKER, original: LIVE_GAP_MARKER, leading: "", trailing: "" });
    if (/[^\s\p{P}]/u.test(part)) {
      result.push(...tokenizeWords(part));
      continue;
    }
    if (part === "") continue;
    const last = result.at(-1);
    if (last !== undefined) last.trailing += part;
    else result.push({ normalized: "", original: "", leading: part, trailing: "" });
  }
  return result;
}

function tokenizeWords(text: string): InputWord[] {
  const result: InputWord[] = [];
  const startMatch = text.match(/^[\s\p{P}]*/u);
  let firstLeading = startMatch?.[0] ?? "";
  let remaining = text;
  if (!text.slice(firstLeading.length)) {
    console.warn(`No words in input: ${JSON.stringify(text)}`);
    return result;
  }

  while (remaining) {
    const leading = firstLeading
      ? firstLeading
      : (remaining.match(/^\p{P}*/u)?.[0] ?? "");
    remaining = remaining.slice(leading.length);
    // FIXME: this only allows one apostrophe, but no other internal punctuation... but there's probably examples I'm missing as a result
    const original =
      remaining.match(/^[^\p{P}\s]*(?:['][^\p{P}\s]+)?/u)?.[0] ?? "";
    remaining = remaining.slice(original.length);
    const trailing = remaining.match(/^\p{P}*\s*/u)?.[0] ?? "";
    remaining = remaining.slice(trailing.length);
    firstLeading = "";
    const normalized = normalizeWord(original);
    const onlyWord = result.length === 1 ? result[0] : undefined;
    const lastWord = result.at(-1);
    if (normalized && onlyWord !== undefined && onlyWord.normalized === "") {
      onlyWord.leading += leading;
      onlyWord.original += original;
      onlyWord.trailing += trailing;
      onlyWord.normalized = normalized;
    } else if (!normalized && lastWord !== undefined) {
      lastWord.trailing += leading + original + trailing;
      continue;
    } else if (!normalized && lastWord === undefined) {
      result.push({
        normalized: "",
        original,
        trailing: "",
        leading: leading + trailing,
      });
    } else {
      result.push({
        normalized,
        original,
        trailing,
        leading,
      });
    }
  }
  return result;
}
