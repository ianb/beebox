/**
 * Whisper's word timings come without punctuation or capitals ("so", "we",
 * "should"), while the same response's `text` has them ("So we should."). Put
 * the text's own tokens back on the timed words, matching each word to the
 * next text token with the same letters, so the transcript reads as speech
 * was written. A word with no match keeps its bare form.
 */

import type { VoiceHqWord } from "../../../capture/staging-schema.js";

/** How far ahead in the text a word may find its token; past this the text and words disagree. */
const LOOKAHEAD = 3;

function letters(token: string): string {
  return token.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, "");
}

export function withPunctuation(words: readonly VoiceHqWord[], text: string): VoiceHqWord[] {
  const tokens = text.split(/\s+/).filter((t) => t !== "");
  let next = 0;
  return words.map((word) => {
    const bare = letters(word.text);
    for (let i = next; i < Math.min(tokens.length, next + LOOKAHEAD); i++) {
      const token = tokens[i];
      if (token !== undefined && bare !== "" && letters(token) === bare) {
        next = i + 1;
        return { ...word, text: token };
      }
    }
    return word;
  });
}
