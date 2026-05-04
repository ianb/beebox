/* eslint-disable security/detect-possible-timing-attacks */
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

function tokenizePattern(src: string): (string | Record<string, string>)[] {
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
      throw new Error(
        `Invalid pattern (bad tag): ${JSON.stringify(src)} at ${JSON.stringify(remaining)}`
      );
    }
    const match = remaining.match(re);
    if (match) {
      if (match[0].trim() || match[0] === "\n") {
        list.push(match[0]);
      }
      remaining = remaining.slice(match[0].length);
      continue;
    }
    throw new Error(
      `Invalid pattern (bad word): ${JSON.stringify(src)} at ${JSON.stringify(remaining)}`
    );
  }
  return list;
}

function normalizeWord(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFKD") // Decompose characters with diacritics
    .replace(/[\u0300-\u036F]/g, "") // Remove diacritics
    .replace(/[^\da-z]/g, ""); // Remove any remaining non-alphanumeric characters
}

// Symmetric plural-tolerant equality so "message" matches "messages",
// "box" matches "boxes", and "party" matches "parties". Words are assumed
// already normalized.
function wordsEqual(a: string, b: string): boolean {
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

interface InputWord {
  normalized: string;
  original: string;
  trailing: string;
  leading: string;
}

function tokenizeInput(text: string): InputWord[] {
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

interface MatchResult {
  captured: InputWord[];
  remaining: InputWord[];
  tags: Record<string, string>;
}

abstract class Matcher {
  constructor(public tags: Record<string, string>) {
    this.tags = tags;
  }
  abstract match(input: InputWord[]): MatchResult[];
  abstract repr(): string;
}

class WordMatcher extends Matcher {
  constructor(
    tags: Record<string, string>,
    private word: string
  ) {
    super(tags);
    this.word = normalizeWord(word);
  }
  match(input: InputWord[]) {
    if (input.length > 0 && wordsEqual(input[0].normalized, this.word)) {
      return [
        {
          captured: input.slice(0, 1),
          remaining: input.slice(1),
          tags: this.tags,
        },
      ];
    }
    return [];
  }
  repr() {
    return this.word;
  }
}

class OptionalMatcher extends Matcher {
  constructor(
    tags: Record<string, string>,
    private matcher: Matcher
  ) {
    super(tags);
  }
  match(input: InputWord[]) {
    const result = this.matcher.match(input);
    return [
      ...result.map((r) => {
        return {
          ...r,
          tags: Object.assign({}, this.tags, r.tags),
        };
      }),
      {
        captured: [],
        remaining: input,
        tags: this.tags,
      },
    ];
  }
  repr() {
    return `${this.matcher.repr()}?`;
  }
}

class SequenceMatcher extends Matcher {
  constructor(
    tags: Record<string, string>,
    private matchers: Matcher[]
  ) {
    super(tags);
  }
  match(input: InputWord[]) {
    let result: MatchResult[] = [
      {
        captured: [],
        remaining: input,
        tags: this.tags,
      },
    ];
    for (const matcher of this.matchers) {
      result = result.flatMap((r) => {
        const next = matcher.match(r.remaining);
        return next.map((n) => ({
          captured: [...r.captured, ...n.captured],
          remaining: n.remaining,
          tags: Object.assign({}, this.tags, n.tags),
        }));
      });
    }
    return result;
  }
  repr() {
    return this.matchers.map((m) => m.repr()).join(" ");
  }
}

interface OrMatcherOptions {
  tags: Record<string, string>;
  matchers: Matcher[];
  separator: string;
}

class OrMatcher extends Matcher {
  private matchers: Matcher[];
  private separator: string;
  constructor(options: OrMatcherOptions) {
    super(options.tags);
    this.separator = options.separator;
    this.matchers = options.matchers;
  }
  match(input: InputWord[]) {
    return this.matchers.flatMap((m) => {
      const result = m.match(input);
      return result.map((r) => ({
        ...r,
        tags: Object.assign({}, this.tags, r.tags),
      }));
    });
  }
  repr() {
    if (this.separator === "|") {
      return `(${this.matchers.map((m) => m.repr()).join(" | ")})`;
    } else if (this.separator === "\n") {
      return this.matchers.map((m) => m.repr()).join("\n");
    } else {
      throw new Error(`Unknown separator: ${this.separator}`);
    }
  }
}

class TokenStream {
  constructor(private tokens: (string | Record<string, string>)[]) {
    this.tokens = tokens;
  }
  next() {
    return this.tokens.shift();
  }
  peek() {
    return this.tokens[0];
  }
  isEmpty() {
    return this.tokens.length === 0;
  }
}

function compileLines(stream: TokenStream): Matcher {
  const matchers: Matcher[] = [];
  let tags: Record<string, string> = {};
  let currentSequence: Matcher[] = [];
  while (true) {
    if (stream.isEmpty() || stream.peek() === "\n") {
      if (currentSequence.length === 0) {
        if (Object.keys(tags).length > 0) {
          throw new Error("Pattern has tags with no words");
        }
        if (stream.isEmpty()) {
          break;
        }
        stream.next();
        continue;
      }
      matchers.push(new SequenceMatcher(tags, currentSequence));
      currentSequence = [];
      tags = {};
      if (stream.isEmpty()) {
        break;
      }
      stream.next();
      continue;
    }
    const token = stream.peek();
    if (typeof token !== "string") {
      Object.assign(tags, token);
      stream.next();
      continue;
    }
    const nextMatcher = compileForWord(stream);
    currentSequence.push(nextMatcher);
  }
  return new OrMatcher({ tags: {}, matchers, separator: "\n" });
}

function compileForWord(stream: TokenStream): Matcher {
  const token = stream.next();
  if (typeof token !== "string") {
    throw new Error("Unexpected tags");
  }
  if (token === "(") {
    return compileGroup(stream);
  }
  if (token === "|") {
    // Treat it like an empty string...
    const match = compileForWord(stream);
    return new OptionalMatcher({}, match);
  }
  if (token === "?" || token === ")") {
    throw new Error(`Unexpected "${token}"`);
  }
  const word = normalizeWord(token);
  if (stream.peek() === "?") {
    stream.next();
    return new OptionalMatcher({}, new WordMatcher({}, word));
  }
  return new WordMatcher({}, word);
}

function compileGroup(stream: TokenStream): Matcher {
  const matchers: Matcher[] = [];
  let currentSequence: Matcher[] = [];
  let isOptional = false;
  while (true) {
    if (stream.isEmpty()) {
      throw new Error("Expected closing )");
    }
    const token = stream.peek();
    if (token === ")") {
      stream.next();
      if (currentSequence.length > 0) {
        if (currentSequence.length === 1) {
          matchers.push(currentSequence[0]);
        } else {
          matchers.push(new SequenceMatcher({}, currentSequence));
        }
      } else {
        // Implies there was an empty group
        isOptional = true;
      }
      if (stream.peek() === "?") {
        stream.next();
        isOptional = true;
      }
      break;
    } else if (token === "|") {
      stream.next();
      if (currentSequence.length > 0) {
        if (currentSequence.length === 1) {
          matchers.push(currentSequence[0]);
        } else {
          matchers.push(new SequenceMatcher({}, currentSequence));
        }
        currentSequence = [];
      } else {
        isOptional = true;
      }
    } else {
      currentSequence.push(compileForWord(stream));
    }
  }
  const orMatch = new OrMatcher({ tags: {}, matchers, separator: "|" });
  if (isOptional) {
    return new OptionalMatcher({}, orMatch);
  }
  return orMatch;
}

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
