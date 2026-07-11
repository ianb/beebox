import { UnknownSeparatorError } from "./errors";
import { type InputWord, normalizeWord, wordsEqual } from "./tokenize";

interface MatchResult {
  captured: InputWord[];
  remaining: InputWord[];
  tags: Record<string, string>;
}

export abstract class Matcher {
  constructor(public tags: Record<string, string>) {
    this.tags = tags;
  }
  abstract match(input: InputWord[]): MatchResult[];
  abstract repr(): string;
}

export class WordMatcher extends Matcher {
  constructor(
    tags: Record<string, string>,
    private word: string
  ) {
    super(tags);
    this.word = normalizeWord(word);
  }
  match(input: InputWord[]) {
    if (input[0] !== undefined && wordsEqual(input[0].normalized, this.word)) {
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

export class OptionalMatcher extends Matcher {
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

export class SequenceMatcher extends Matcher {
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

export class OrMatcher extends Matcher {
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
      throw new UnknownSeparatorError(this.separator);
    }
  }
}
