/*
This is a keyword pattern matching library.

The patterns look like:

"(a | the) test"

Which matches "a test" or "the test" or "the test!" etc.

Patterns have these options:

1. A sequence of words
2. Or for any word there can be a list of words: "a|b" (allowed without parenthesis for just two words) or "(a | b | c)" (for multiple words)
3. You can also have multiple words in parenthesis like "(some day | today)"
4. Or a word can be optional like "a?" or "(a | b)?" or implicitly like "(a | b | )"

Words are matched in a normalized form.

The input words are tokenized like:

* `word.normalized`: a normalized form of the word
* `word.original`: the unnormalized form
word.trailing: any trailing whitespace or punctuation
* `word.leading`: any leading punctuation, and leading whitespace for the first word

If you join leading+original+trailing then you'll get exactly the original string.

*/

import { compileLines, TokenStream } from "./patmatch-compile";
import { type Matcher } from "./patmatch-matchers";
import {
  type InputWord,
  normalizeWord,
  tokenizeInput,
  tokenizePattern,
} from "./patmatch-tokenize";

export class InputMatch {
  leading: InputWord[];
  captured: InputWord[];
  remaining: InputWord[];
  tags: Record<string, string>;

  constructor({
    leading,
    captured,
    remaining,
    tags,
  }: {
    leading: InputWord[];
    captured: InputWord[];
    remaining: InputWord[];
    tags: Record<string, string>;
  }) {
    this.leading = leading;
    this.captured = captured;
    this.remaining = remaining;
    this.tags = tags;
  }

  static joinInput(words: InputWord[]) {
    return words.map((w) => `${w.leading}${w.original}${w.trailing}`).join("");
  }

  get capturedText() {
    return InputMatch.joinInput(this.captured);
  }

  get capturedTextTrimmed() {
    return InputMatch.joinInput(this.captured).trim();
  }

  replace(replacement: string) {
    return (
      InputMatch.joinInput(this.leading) +
      replacement +
      InputMatch.joinInput(this.remaining)
    );
  }

  replaceTrimmed(replacement: string) {
    // Like .replace(), but it leaves leading and trailing whitespace in place
    const original = this.capturedText;
    const leadingWhitespace = original.match(/^\s*/)?.[0] ?? "";
    const trailingWhitespace = original.match(/\s*$/)?.[0] ?? "";
    return (
      InputMatch.joinInput(this.leading) +
      leadingWhitespace +
      replacement +
      trailingWhitespace +
      InputMatch.joinInput(this.remaining)
    );
  }
}

export class KeywordPattern {
  constructor(public matcher: Matcher) {
    this.matcher = matcher;
  }

  match(input: string): InputMatch | undefined {
    if (!input.trim()) {
      return undefined;
    }
    const words = tokenizeInput(input);
    for (let i = 0; i < words.length; i++) {
      const rest = words.slice(i);
      const matchResults = this.matcher.match(rest);
      if (matchResults.length > 0) {
        return new InputMatch({
          leading: words.slice(0, i),
          captured: matchResults[0].captured,
          remaining: matchResults[0].remaining,
          tags: matchResults[0].tags,
        });
      }
    }
    return undefined;
  }

  static compile(pattern: string): KeywordPattern {
    const tokens = tokenizePattern(pattern);
    const matcher = compileLines(new TokenStream(tokens));
    return new KeywordPattern(matcher);
  }
}

export const TESTING_EXPORTS = {
  normalizeWord,
  tokenizePattern,
  tokenizeInput,
};
