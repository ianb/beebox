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

import { buildDiff } from "./diff.js";
import { normalizeLiteral } from "./literal.js";
import { matchExtractions, emptyExtractions, type Extractions } from "./match.js";
import { serialize, serializeWithSource } from "./serialize.js";
import { mismatchHint, suggestExpected } from "./suggest.js";

// Re-export public API from submodules
export { serialize, registerSerializer } from "./serialize.js";
export { type Extractions } from "./match.js";

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

/** The print function passed to check() callbacks */
export type PrintFn = (text: string) => void;

/**
 * Assert that `actual` matches `expected`.
 *
 * `actual` can be:
 *  - A direct value (string, object, number, etc.) — serialized and compared
 *  - A Promise — awaited, then serialized and compared (returns a Promise)
 *  - A function — called, return value serialized and compared
 *    (if the function returns a Promise, that's awaited too)
 *
 * `expected` is always a string, and may contain `«»` wildcards.
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
 * check(logEntry, `[«date»] commit «hash=*»: initial commit`);
 */
export function check(actual: unknown, expected: string | CheckOptions): Extractions | Promise<Extractions> {
  if (typeof actual === "function") {
    const lines: string[] = [];
    const print: PrintFn = (text: string) => lines.push(text);
    const returnValue = (actual as (print: PrintFn) => unknown)(print);

    if (returnValue instanceof Promise) {
      return returnValue.then((value) => {
        return throwIfFailed(buildPrinterOutput(lines, value), { expected, caller: check });
      });
    }

    return throwIfFailed(buildPrinterOutput(lines, returnValue), { expected, caller: check });
  }

  if (actual instanceof Promise) {
    return actual.then((value) => throwIfFailed(value, { expected, caller: check }));
  }

  return throwIfFailed(actual, { expected, caller: check });
}

function buildPrinterOutput(lines: string[], returnValue: unknown): string {
  const parts: string[] = [...lines];

  // Append serialized return value if non-void
  if (returnValue !== undefined && returnValue !== null) {
    parts.push(serialize(returnValue));
  }

  return parts.join("\n");
}

function throwIfFailed(actual: unknown, opts: { expected: string | CheckOptions; caller: (...args: never[]) => unknown }): Extractions {
  const result = compare(actual, opts.expected);
  if (result.pass) return result.extractions;

  const err = new CheckError(result.message, result);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- @types/node declares captureStackTrace as always present, but it's a non-spec V8 extension genuinely absent on other engines
  if (Error.captureStackTrace) {
    Error.captureStackTrace(err, opts.caller);
  }
  throw err;
}

// ── Inspect ──────────────────────────────────────────────────────────────────

interface CheckResultBase {
  /** The serialized actual value */
  actual: string;
  /** The expected string (after normalization if applicable) */
  expected: string;
  /** Full message (includes label and diff) on failure, empty on pass */
  message: string;
  /** Captured wildcard values (positional + named) */
  extractions: Extractions;
  /**
   * Set when the expected value was `«show»`: the check passes and the runner
   * prints the actual value as a TAP comment. For values that vary and are
   * worth seeing in the run's output without asserting them.
   */
  shown?: string;
}

interface CheckFailure {
  pass: false;
  diff: string;
  /**
   * A paste-ready expected value: the actual text with volatile parts as
   * wildcards and blank lines as `«blankline»`, or the raw actual text when
   * that rewrite would not match.
   */
  suggested: string;
  /** Advice for a recognized mismatch shape (quoted string, boolean), or null */
  hint: string | null;
}

/**
 * Result of comparing actual vs expected, without throwing. A discriminated
 * union on `pass` — `diff`, `suggested`, and `hint` are only meaningful on failure.
 */
export type CheckResult =
  | (CheckResultBase & { pass: true; diff: null; suggested: null; hint: null })
  | (CheckResultBase & CheckFailure);

/**
 * Same as check() but returns a result instead of throwing.
 * Use this to examine diffs programmatically or to test check() itself.
 *
 * @example
 * const r = inspect("actual", "expected");
 * console.log(r.pass);    // false
 * console.log(r.diff);    // the visual diff
 * console.log(r.actual);  // "actual"
 */
export function inspect(actual: unknown, expected: string | CheckOptions): CheckResult | Promise<CheckResult> {
  if (typeof actual === "function") {
    const lines: string[] = [];
    const print: PrintFn = (text: string) => lines.push(text);
    const returnValue = (actual as (print: PrintFn) => unknown)(print);

    if (returnValue instanceof Promise) {
      return returnValue.then((value) => {
        const actualStr = buildPrinterOutput(lines, value);
        return compare(actualStr, expected);
      });
    }

    const actualStr = buildPrinterOutput(lines, returnValue);
    return compare(actualStr, expected);
  }

  if (actual instanceof Promise) {
    return actual.then((value) => compare(value, expected));
  }

  return compare(actual, expected);
}

// ── Core comparison ──────────────────────────────────────────────────────────

function compare(actual: unknown, expected: string | CheckOptions): CheckResult {
  const opts = typeof expected === "object" ? expected : undefined;
  let expectedStr = typeof expected === "object" ? expected.expected : expected;
  const serialized = serializeWithSource(actual);
  let actualStr = serialized.text;

  if (opts?.normalizeWhitespace) {
    actualStr = normalizeWS(actualStr);
    expectedStr = normalizeWS(expectedStr);
  }

  if (expectedStr.trim() === "«show»") {
    return { pass: true, actual: actualStr, expected: expectedStr, diff: null, suggested: null, hint: null, message: "", extractions: emptyExtractions(), shown: actualStr };
  }

  let extractions = matchExtractions(actualStr, expectedStr);

  // B1: an expected JS/JSON literal is re-serialized like the default
  // serializer would, then text-matched again. Never for strings or
  // custom-serialized values.
  if (extractions === null && typeof actual !== "string" && !serialized.custom && !opts?.normalizeWhitespace) {
    // Pretty JSON the author wrote is compared as written, key order and all;
    // only a literal in another form has its key order taken from the actual.
    const plain = normalizeLiteral(expectedStr);
    const normalized = plain !== null && plain !== expectedStr ? normalizeLiteral(expectedStr, { orderLike: actual }) : null;
    if (normalized !== null) {
      expectedStr = normalized;
      extractions = matchExtractions(actualStr, expectedStr);
    }
  }

  if (extractions !== null) {
    return { pass: true, actual: actualStr, expected: expectedStr, diff: null, suggested: null, hint: null, message: "", extractions };
  }

  const label = opts?.label ? ` (${opts.label})` : "";
  return {
    pass: false,
    actual: actualStr,
    expected: expectedStr,
    diff: buildDiff(actualStr, expectedStr),
    suggested: suggestExpected(actualStr, expectedStr) ?? actualStr,
    hint: mismatchHint(actualStr, typeof expected === "object" ? expected.expected : expected),
    message: `check failed${label}`,
    extractions: emptyExtractions(),
  };
}

function normalizeWS(s: string): string {
  return s.replace(/[\t ]+/g, " ").replace(/^ | $/gm, "").trim();
}

/**
 * Distinct error class so test runners can identify check failures
 * vs unexpected exceptions.
 */
export class CheckError extends Error {
  diff: string;
  found: string;
  wanted: string;
  suggested: string;
  hint: string | null;

  constructor(message: string, result: { diff: string; actual: string; expected: string; suggested: string; hint: string | null }) {
    super(message);
    this.name = "CheckError";
    this.diff = result.diff;
    this.found = result.actual;
    this.wanted = result.expected;
    this.suggested = result.suggested;
    this.hint = result.hint;
  }
}
