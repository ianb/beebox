import { BadTagError, BadWordError } from "./patmatch-errors";

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
      const name = tagMatch[1];
      const value = tagMatch[2];
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

export function tokenizeInput(text: string): InputWord[] {
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
    if (normalized && result.length === 1 && result[0].normalized === "") {
      result[0].leading += leading;
      result[0].original += original;
      result[0].trailing += trailing;
      result[0].normalized = normalized;
    } else if (!normalized && result.length > 0) {
      result[result.length - 1].trailing += leading + original + trailing;
      continue;
    } else if (!normalized && result.length === 0) {
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
