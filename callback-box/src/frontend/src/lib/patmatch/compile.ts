/* eslint-disable security/detect-possible-timing-attacks */
import {
  ExpectedClosingParenError,
  TagsWithNoWordsError,
  UnexpectedTagsError,
  UnexpectedTokenError,
} from "./errors";
import {
  type Matcher,
  OptionalMatcher,
  OrMatcher,
  SequenceMatcher,
  WordMatcher,
} from "./matchers";
import { normalizeWord } from "./tokenize";

export class TokenStream {
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

export function compileLines(stream: TokenStream): Matcher {
  const matchers: Matcher[] = [];
  let tags: Record<string, string> = {};
  let currentSequence: Matcher[] = [];
  for (;;) {
    if (stream.isEmpty() || stream.peek() === "\n") {
      if (currentSequence.length === 0) {
        if (Object.keys(tags).length > 0) {
          throw new TagsWithNoWordsError();
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
    throw new UnexpectedTagsError();
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
    throw new UnexpectedTokenError(token);
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
  for (;;) {
    if (stream.isEmpty()) {
      throw new ExpectedClosingParenError();
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
