export class BadTagError extends Error {
  constructor(src: string, remaining: string) {
    super(
      `Invalid pattern (bad tag): ${JSON.stringify(src)} at ${JSON.stringify(remaining)}`
    );
    this.name = "BadTagError";
  }
}

export class BadWordError extends Error {
  constructor(src: string, remaining: string) {
    super(
      `Invalid pattern (bad word): ${JSON.stringify(src)} at ${JSON.stringify(remaining)}`
    );
    this.name = "BadWordError";
  }
}

export class UnknownSeparatorError extends Error {
  constructor(separator: string) {
    super(`Unknown separator: ${separator}`);
    this.name = "UnknownSeparatorError";
  }
}

export class TagsWithNoWordsError extends Error {
  constructor() {
    super("Pattern has tags with no words");
    this.name = "TagsWithNoWordsError";
  }
}

export class UnexpectedTagsError extends Error {
  constructor() {
    super("Unexpected tags");
    this.name = "UnexpectedTagsError";
  }
}

export class UnexpectedTokenError extends Error {
  constructor(token: string) {
    super(`Unexpected "${token}"`);
    this.name = "UnexpectedTokenError";
  }
}

export class ExpectedClosingParenError extends Error {
  constructor() {
    super("Expected closing )");
    this.name = "ExpectedClosingParenError";
  }
}
