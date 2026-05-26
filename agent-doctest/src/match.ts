/**
 * Wildcard matching and diff output for check() assertions.
 *
 * Guillemet wildcards («date», «name=*», etc.) allow fuzzy matching
 * against volatile values. On mismatch, a human-readable diff is
 * produced showing exactly where things diverge.
 */

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

export function emptyExtractions(): Extractions {
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

export interface MatchResult {
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
export function matchWithWildcards(actual: string, expected: string): MatchResult {
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
