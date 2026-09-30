/**
 * The grammar of a fence's info string: `<lang>? <directive>* <key>=<value>*`.
 *
 * Only executable languages (`ts`, `typescript`, `js`, `javascript`, or no
 * language) make a fence part of the test. Any other language (`json`,
 * `bash`, `text`, …) is documentation, so prose can show a config file or a
 * shell command without the runner trying to execute it.
 *
 * Directives used to be matched with `info.includes("setup")`, so a typo or an
 * invented word (`ts teardown`, before it existed) silently turned the block
 * into an ordinary example test. Unknown words are now an error.
 */

const EXECUTABLE_LANGS = new Set(["", "ts", "typescript", "js", "javascript"]);

/** What a fence is for. */
export type BlockKind = "setup" | "example" | "continue" | "cleanup" | "continue-cleanup" | "teardown" | "prose";

export interface FenceInfo {
  kind: BlockKind;
  /** `timeout=<n>s` — how long an example may run before the still-running notice. */
  timeoutMs: number | null;
}

/** An info string that names an unknown directive or option. */
export class FenceInfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FenceInfoError";
  }
}

const DIRECTIVES = new Set(["setup", "continue", "cleanup", "teardown"]);

function kindOf(directives: string[]): BlockKind {
  const key = directives.toSorted().join(" ");
  switch (key) {
    case "":
      return "example";
    case "setup":
    case "continue":
    case "cleanup":
    case "teardown":
      return key;
    case "cleanup continue":
      return "continue-cleanup";
    default:
      throw new FenceInfoError(
        `directives "${directives.join(" ")}" cannot be combined; the only combination is "continue cleanup"`,
      );
  }
}

function parseTimeout(value: string): number {
  const m = /^(\d+)(ms|s)?$/.exec(value);
  if (!m) throw new FenceInfoError(`timeout=${value} is not a duration; write e.g. timeout=120s`);
  const n = Number(m[1]);
  return m[2] === "ms" ? n : n * 1000;
}

/** Parse a fence info string. Throws {@link FenceInfoError} on unknown words. */
export function parseFenceInfo(info: string): FenceInfo {
  const words = info.trim().split(/\s+/).filter((w) => w.length > 0);
  const first = words[0] ?? "";
  let rest = words;
  if (EXECUTABLE_LANGS.has(first)) rest = words.slice(1);
  else if (!DIRECTIVES.has(first) && !first.includes("=")) return { kind: "prose", timeoutMs: null };

  const directives: string[] = [];
  let timeoutMs: number | null = null;
  for (const word of rest) {
    const eq = word.indexOf("=");
    if (eq !== -1) {
      const key = word.slice(0, eq);
      if (key !== "timeout") throw new FenceInfoError(`unknown fence option "${key}"; the only option is timeout=<n>s`);
      timeoutMs = parseTimeout(word.slice(eq + 1));
    } else if (DIRECTIVES.has(word)) {
      directives.push(word);
    } else {
      throw new FenceInfoError(
        `"${word}" is not a doctest directive; use setup, continue, cleanup, or teardown`,
      );
    }
  }
  return { kind: kindOf(directives), timeoutMs };
}
