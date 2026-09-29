/**
 * Guillemet wildcard parsing («date», «name=*», etc.), shared by the
 * whole-text matcher (match.ts) and the line-level diff (diff.ts).
 */

import { invariant } from "./invariant.js";

/** Typed wildcard patterns — known type names map to regex fragments. */
export const WILDCARD_TYPES: Record<string, string> = {
  date: "\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?Z?)?",
  uuid: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  int: "-?\\d+",
  number: "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?",
  string: "(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')",
  codeblock: "```",
  blankline: "",
};

/** Parsed wildcard token metadata. */
export interface WildcardToken {
  /** Regex pattern for this wildcard's capturing group */
  pattern: string;
  /** Name to assign this capture (null = positional only) */
  name: string | null;
  /** The type name («date» and «at=date» are both "date"; «*» and unknowns are "*") */
  type: string;
}

/** Splits text into literal parts and `«…»` tokens (tokens at odd indexes). */
export const WILDCARD_SPLIT = /(«[^»]*»)/;

/**
 * Parse a wildcard token's inner content (between «»).
 *
 * Syntax:  «*»           → anything, no name
 *          «date»        → known type, name defaults to "date"
 *          «hash»        → unknown token → anything, anonymous (use «hash=*» for named)
 *          «start=date»  → named "start", typed as date
 *          «val=*»       → named "val", anything
 */
export function parseWildcardToken(content: string): WildcardToken {
  // Check for name=type syntax
  const eqIdx = content.indexOf("=");
  if (eqIdx !== -1) {
    const name = content.slice(0, eqIdx);
    const typeName = content.slice(eqIdx + 1);
    const known = typeName !== "*" && typeName in WILDCARD_TYPES;
    const pattern = known ? WILDCARD_TYPES[typeName] ?? "[\\s\\S]*" : "[\\s\\S]*";
    return { pattern, name: name || null, type: known ? typeName : "*" };
  }

  // Explicit "anything"
  if (content === "*") {
    return { pattern: "[\\s\\S]*", name: null, type: "*" };
  }

  // Known type — use its pattern, default name to the type name
  if (content in WILDCARD_TYPES) {
    const pattern = WILDCARD_TYPES[content];
    invariant(pattern !== undefined, "content was just confirmed to be a WILDCARD_TYPES key");
    return { pattern, name: content, type: content };
  }

  // Unknown token — treat as anonymous wildcard (use «name=*» for named capture)
  return { pattern: "[\\s\\S]*", name: null, type: "*" };
}

/** Compile expected text with wildcards into an anchored regex plus its tokens. */
export function compileWildcards(expected: string): { re: RegExp; tokens: WildcardToken[] } {
  const tokens: WildcardToken[] = [];
  let pattern = "^";
  for (const part of expected.split(WILDCARD_SPLIT)) {
    if (part.startsWith("«") && part.endsWith("»")) {
      const token = parseWildcardToken(part.slice(1, -1));
      tokens.push(token);
      pattern += `(${token.pattern})`;
    } else {
      pattern += escapeRegex(part);
    }
  }
  return { re: new RegExp(`${pattern}$`), tokens };
}

function escapeRegex(s: string): string {
  return s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}
