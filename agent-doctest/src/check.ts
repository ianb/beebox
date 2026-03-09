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

/** Typed wildcard patterns — known type names map to regex fragments. */
const WILDCARD_TYPES: Record<string, string> = {
  date: "\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?Z?)?",
  uuid: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  int: "-?\\d+",
  number: "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?",
  string: "(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')",
  codeblock: "```",
  blankline: "",
};

/** Extractions: an array of positional captures with named properties. */
export type Extractions = string[] & Record<string, string>;

function emptyExtractions(): Extractions {
  return [] as unknown as Extractions;
}

/** Parsed wildcard token metadata. */
interface WildcardToken {
  /** Regex pattern for this wildcard's capturing group */
  pattern: string;
  /** Name to assign this capture (null = positional only) */
  name: string | null;
}

/**
 * Parse a wildcard token's inner content (between «»).
 *
 * Syntax:  «*»           → anything, no name
 *          «date»        → known type, name defaults to "date"
 *          «hash»        → unknown token → anything, anonymous (use «hash=*» for named)
 *          «start=date»  → named "start", typed as date
 *          «val=*»       → named "val", anything
 */
function parseWildcardToken(content: string): WildcardToken {
  // Check for name=type syntax
  const eqIdx = content.indexOf("=");
  if (eqIdx !== -1) {
    const name = content.slice(0, eqIdx);
    const typeName = content.slice(eqIdx + 1);
    const pattern = typeName === "*" ? "[\\s\\S]*" : WILDCARD_TYPES[typeName] ?? "[\\s\\S]*";
    return { pattern, name: name || null };
  }

  // Explicit "anything"
  if (content === "*") {
    return { pattern: "[\\s\\S]*", name: null };
  }

  // Known type — use its pattern, default name to the type name
  if (content in WILDCARD_TYPES) {
    return { pattern: WILDCARD_TYPES[content]!, name: content };
  }

  // Unknown token — treat as anonymous wildcard (use «name=*» for named capture)
  return { pattern: "[\\s\\S]*", name: null };
}

interface MatchResult {
  matched: boolean;
  diff: string | null;
  extractions: Extractions;
}

/**
 * Match actual text against an expected pattern that may contain wildcards.
 *
 * Guillemet wildcards: «*», «date», «name=type», etc.
 *
 * Returns a MatchResult with extractions on success.
 */
function matchWithWildcards(actual: string, expected: string): MatchResult {
  // Fast path: no wildcards
  if (!expected.includes("«")) {
    if (actual === expected) return { matched: true, diff: null, extractions: emptyExtractions() };
    return { matched: false, diff: buildDiff(actual, expected), extractions: emptyExtractions() };
  }

  // Split expected on guillemet wildcard tokens
  const parts = expected.split(/(«[^»]*»)/);
  const tokens: WildcardToken[] = [];

  let pattern = "^";
  for (const part of parts) {
    // Guillemet wildcard: «content»
    if (part.startsWith("«") && part.endsWith("»")) {
      const content = part.slice(1, -1);
      const token = parseWildcardToken(content);
      tokens.push(token);
      pattern += `(${token.pattern})`;
    }
    // Literal text
    else {
      pattern += escapeRegex(part);
    }
  }
  pattern += "$";

  const re = new RegExp(pattern);
  const match = re.exec(actual);

  if (!match) {
    return { matched: false, diff: buildDiff(actual, expected), extractions: emptyExtractions() };
  }

  // Build extractions from capture groups
  const extractions = emptyExtractions();
  let groupIdx = 1;
  for (const token of tokens) {
    const value = match[groupIdx++] ?? "";
    extractions.push(value);
    if (token.name !== null && !(token.name in extractions)) {
      (extractions as Record<string, string>)[token.name] = value;
    }
  }

  return { matched: true, diff: null, extractions };
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

/** The print function passed to check() callbacks */
export type PrintFn = (text: string) => void;

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

  const err = new CheckError(result.message, { diff: result.diff!, found: result.actual, wanted: result.expected });
  if (Error.captureStackTrace) {
    Error.captureStackTrace(err, opts.caller);
  }
  throw err;
}

// ── Inspect ──────────────────────────────────────────────────────────────────

/**
 * Result of comparing actual vs expected, without throwing.
 */
export interface CheckResult {
  /** Whether the check passed */
  pass: boolean;
  /** The serialized actual value */
  actual: string;
  /** The expected string (after normalization if applicable) */
  expected: string;
  /** Diff text on failure, null on pass */
  diff: string | null;
  /** Full message (includes label and diff) on failure, empty on pass */
  message: string;
  /** Captured wildcard values (positional + named) */
  extractions: Extractions;
}

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

  const result = matchWithWildcards(actualStr, expectedStr);

  if (result.matched) {
    return { pass: true, actual: actualStr, expected: expectedStr, diff: null, message: "", extractions: result.extractions };
  }

  const label = opts?.label ? ` (${opts.label})` : "";
  return {
    pass: false,
    actual: actualStr,
    expected: expectedStr,
    diff: result.diff,
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

  constructor(message: string, result: { diff: string; found: string; wanted: string }) {
    super(message);
    this.name = "CheckError";
    this.diff = result.diff;
    this.found = result.found;
    this.wanted = result.wanted;
  }
}
