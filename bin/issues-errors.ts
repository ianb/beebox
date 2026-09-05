/**
 * Every way `bin/issues` refuses a command, as one class per failure.
 *
 * `UsageError` stays the base: `bin/issues.ts` catches it to print
 * `issues: <message>` and exit 2, so anything the user can be told about
 * (rather than a crash) extends it. Messages are composed in the constructors
 * — they are what an agent reads at the terminal, so treat them as a surface.
 */

export class UsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class InvalidFlagValueError extends UsageError {
  public constructor(flag: string, allowed: readonly string[]) {
    super(`${flag} must be one of: ${allowed.join(", ")}`);
    this.name = "InvalidFlagValueError";
  }
}

export class InvalidSinceError extends UsageError {
  public constructor() {
    super("--since must be YYYY-MM-DD");
    this.name = "InvalidSinceError";
  }
}

export class InvalidIntegerFlagError extends UsageError {
  public constructor(readonly flag: string) {
    super(`${flag} must be a non-negative integer`);
    this.name = "InvalidIntegerFlagError";
  }
}

/**
 * An explicit `--mode hybrid|semantic` with no key in the environment. The
 * "--mode text" advice is only offered where the caller could actually take it
 * (`similar` ranks semantically by construction).
 */
export class MissingEmbeddingsKeyError extends UsageError {
  public constructor(input: { mode: string; keyVars: readonly string[]; textIsAnOption: boolean }) {
    super(
      `${input.mode} ranking needs an embeddings key (set one of ${input.keyVars.join(", ")})`
      + (input.textIsAnOption ? "; --mode text ranks with BM25 and never uses the network" : ""),
    );
    this.name = "MissingEmbeddingsKeyError";
  }
}

/** Vector ranking asked for over a corpus that is only partly embedded. */
export class CorpusNotEmbeddedError extends UsageError {
  public constructor(input: { mode: string; detail: string; textIsAnOption: boolean }) {
    super(
      `${input.mode} ranking needs the whole corpus embedded — ${input.detail}. `
      + "Re-run to finish embedding (stderr above says why it stopped)"
      + (input.textIsAnOption ? ", or use --mode text" : ""),
    );
    this.name = "CorpusNotEmbeddedError";
  }
}

export class AmbiguousIssueError extends UsageError {
  public constructor(needle: string, count: number) {
    super(`"${needle}" matches ${String(count)} issues; be more specific`);
    this.name = "AmbiguousIssueError";
  }
}

export class NoSuchIssueError extends UsageError {
  public constructor(readonly needle: string) {
    super(`no issue matches "${needle}"`);
    this.name = "NoSuchIssueError";
  }
}

export class MissingGroupKeyError extends UsageError {
  public constructor(readonly keys: string) {
    super(`groups needs --by ${keys}`);
    this.name = "MissingGroupKeyError";
  }
}

export class MissingSearchQueryError extends UsageError {
  public constructor() {
    super("search needs a query");
    this.name = "MissingSearchQueryError";
  }
}

export class NoEmbeddingsKeyError extends UsageError {
  public constructor() {
    super("no embeddings key in the environment (see --help)");
    this.name = "NoEmbeddingsKeyError";
  }
}

export class NoQueryVectorError extends UsageError {
  public constructor() {
    super("the embeddings service returned no vector for the query");
    this.name = "NoQueryVectorError";
  }
}

/**
 * `similar` and `show` each take one issue path. One class per subcommand, so
 * the message is hardcoded rather than assembled from a caller's literal.
 */
export class MissingSimilarPathError extends UsageError {
  public constructor() {
    super("similar needs an issue path");
    this.name = "MissingSimilarPathError";
  }
}

export class MissingShowPathError extends UsageError {
  public constructor() {
    super("show needs an issue path");
    this.name = "MissingShowPathError";
  }
}

export class NoStoredEmbeddingError extends UsageError {
  public constructor(readonly issuePath: string) {
    super(`${issuePath} has no stored embedding`);
    this.name = "NoStoredEmbeddingError";
  }
}

export class UnknownSubcommandError extends UsageError {
  public constructor(readonly command: string) {
    super(`unknown subcommand "${command}"`);
    this.name = "UnknownSubcommandError";
  }
}
