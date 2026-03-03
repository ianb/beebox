/**
 * String-comparison testing primitive.
 *
 * Everything becomes a string before comparison. Serializers convert
 * domain objects to readable text. Wildcards allow fuzzy matching.
 * Errors include a visual diff showing exactly where things diverge.
 *
 * Designed to coexist with tap's t.equal/t.same — use check() for
 * string-oriented "does this output look right?" assertions, use tap
 * for structural equality.
 */

// ── Serializers ──────────────────────────────────────────────────────────────

type Serializer = (value: unknown) => string | null;

const serializers: Serializer[] = [];

/**
 * Register a serializer. Serializers are tried in order; the first
 * one that returns a non-null string wins. Application code registers
 * domain-specific serializers (Card, GitStatus, etc.); the framework
 * provides fallbacks.
 */
export function registerSerializer(fn: Serializer): void {
  serializers.push(fn);
}

/**
 * Convert any value to a string for comparison.
 *
 * Tries registered serializers first, then falls back to:
 *  - strings pass through unchanged
 *  - undefined/null become "undefined"/"null"
 *  - objects get JSON.stringify with 2-space indent
 *  - everything else gets String()
 */
export function serialize(value: unknown): string {
  for (const s of serializers) {
    const result = s(value);
    if (result !== null) return result;
  }

  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

// ── Wildcards ────────────────────────────────────────────────────────────────

/**
 * Match actual text against an expected pattern that may contain wildcards.
 *
 * `___` matches any sequence of characters (including empty).
 * Named wildcards like `___date___` also match any sequence but
 * are labeled in error output for clarity.
 *
 * Returns null on match, or a diagnostic string on mismatch.
 */
function matchWithWildcards(actual: string, expected: string): string | null {
  // Fast path: no wildcards
  if (!expected.includes("___")) {
    if (actual === expected) return null;
    return buildDiff(actual, expected);
  }

  // Split expected on wildcard tokens, preserving the token names
  // Matches ___name___ (named) or ___ (bare)
  const parts = expected.split(/(___\w+___|___)/);
  // Build a regex: literal parts are escaped, wildcards become [\s\S]*
  let pattern = "^";
  for (const part of parts) {
    if (/^___(\w+___)?$/.test(part)) {
      pattern += "([\\s\\S]*)";
    } else {
      pattern += escapeRegex(part);
    }
  }
  pattern += "$";

  const re = new RegExp(pattern);
  if (re.test(actual)) return null;

  // No match — show what we expected vs what we got
  return buildDiff(actual, expected);
}

function escapeRegex(s: string): string {
  return s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

// ── Diff output ──────────────────────────────────────────────────────────────

/**
 * Build a human-readable diff between actual and expected strings.
 *
 * For short strings: show them side by side with a marker at the
 * first difference. For multi-line: show a line-by-line diff.
 */
function buildDiff(actual: string, expected: string): string {
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");

  // Single-line case: show pointer to first difference
  if (actualLines.length === 1 && expectedLines.length === 1) {
    let diffIdx = 0;
    while (diffIdx < actual.length && diffIdx < expected.length && actual[diffIdx] === expected[diffIdx]) {
      diffIdx++;
    }
    const lines = [
      `expected: ${JSON.stringify(expected)}`,
      `  actual: ${JSON.stringify(actual)}`,
    ];
    if (diffIdx < Math.max(actual.length, expected.length)) {
      // +10 for "expected: " prefix, +2 for JSON quote
      lines.push(`  ${"~".repeat(diffIdx + 10 + 1)}^`);
    }
    return lines.join("\n");
  }

  // Multi-line: line-by-line diff
  const lines: string[] = [];
  const maxLen = Math.max(actualLines.length, expectedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const a = actualLines[i];
    const e = expectedLines[i];

    if (a === undefined) {
      lines.push(`  + ${e}`);
    } else if (e === undefined) {
      lines.push(`  - ${a}`);
    } else if (a === e) {
      lines.push(`    ${a}`);
    } else {
      lines.push(`  - ${a}`);
      lines.push(`  + ${e}`);
    }
  }

  return `expected vs actual:\n${lines.join("\n")}`;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface CheckOptions {
  /** The expected string (required when passing options object) */
  expected: string;
  /** Collapse whitespace runs and trim before comparing */
  normalizeWhitespace?: boolean;
  /** A label for the check, shown in error messages */
  label?: string;
}

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Assert that `actual` matches `expected`.
 *
 * `actual` can be:
 *  - A direct value (string, object, number, etc.) — serialized and compared
 *  - A Promise — awaited, then serialized and compared (returns a Promise)
 *  - A function — called, return value serialized and compared
 *    (if the function returns a Promise, that's awaited too)
 *
 * `expected` is always a string, and may contain `___` wildcards.
 *
 * Throws a CheckError on mismatch with a visual diff.
 *
 * @example
 * check(safeFilename("Hello World!"), "Hello_World");
 *
 * @example
 * // Async — await the result
 * await check(getStatus(boxRoot), `{
 *   "staged": [],
 *   "modified": [],
 *   "untracked": [],
 *   "clean": true
 * }`);
 *
 * @example
 * // Function with printer — captures side-effect output
 * check((print) => {
 *   writeFile("test.txt", "hello");
 *   print("wrote: test.txt");
 *   return readFile("test.txt");
 * }, `wrote: test.txt
 * hello`);
 *
 * @example
 * // Wildcards
 * check(logEntry, `[___date___] commit ___hash___: initial commit`);
 */
export function check(actual: unknown, expected: string | CheckOptions): void | Promise<void> {
  if (typeof actual === "function") {
    return callWithPrinter(actual as (print: PrintFn) => unknown, expected);
  }

  if (actual instanceof Promise) {
    return actual.then((value) => compareAndThrow(value, expected));
  }

  compareAndThrow(actual, expected);
}

/** The print function passed to check() callbacks */
export type PrintFn = (text: string) => void;

function callWithPrinter(fn: (print: PrintFn) => unknown, expected: string | CheckOptions): void | Promise<void> {
  const lines: string[] = [];
  const print: PrintFn = (text: string) => lines.push(text);
  const returnValue = fn(print);

  if (returnValue instanceof Promise) {
    return returnValue.then((value) => {
      const actualStr = buildPrinterOutput(lines, value);
      compareAndThrow(actualStr, expected);
    });
  }

  const actualStr = buildPrinterOutput(lines, returnValue);
  compareAndThrow(actualStr, expected);
}

function buildPrinterOutput(lines: string[], returnValue: unknown): string {
  const parts: string[] = [...lines];

  // Append serialized return value if non-void
  if (returnValue !== undefined && returnValue !== null) {
    parts.push(serialize(returnValue));
  }

  return parts.join("\n");
}

function compareAndThrow(actual: unknown, expected: string | CheckOptions): void {
  let opts: CheckOptions | undefined;
  let expectedStr: string;

  if (typeof expected === "object") {
    opts = expected;
    expectedStr = expected.expected;
  } else {
    expectedStr = expected;
  }

  let actualStr = serialize(actual);

  if (opts?.normalizeWhitespace) {
    actualStr = normalizeWS(actualStr);
    expectedStr = normalizeWS(expectedStr);
  }

  const diagnostic = matchWithWildcards(actualStr, expectedStr);
  if (diagnostic === null) return;

  const label = opts?.label ? ` (${opts.label})` : "";
  const err = new CheckError(`check failed${label}\n${diagnostic}`);

  // Remove check() itself from the stack trace so the error
  // points at the caller's line
  if (Error.captureStackTrace) {
    Error.captureStackTrace(err, compareAndThrow);
  }

  throw err;
}

function normalizeWS(s: string): string {
  return s.replace(/[\t ]+/g, " ").replace(/^ | $/gm, "").trim();
}

/**
 * Distinct error class so test runners can identify check failures
 * vs unexpected exceptions.
 */
export class CheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckError";
  }
}
