import type { ParsedRef, RefFragment } from "./types.js";

/**
 * Parse a reference string into its components.
 *
 * Reference format: path[@version][#fragment]
 *
 * Examples:
 * - ./Other.card
 * - ./Other.card@1.0.0
 * - ./Other.card#section
 * - ./Other.card@1.0.0#section
 * - ./Other.card#query(//element)
 * - /absolute/path.card@2.0.0#id
 *
 * @param ref - The reference string to parse
 * @returns The parsed reference structure
 */
export function parseRef(ref: string): ParsedRef {
  let remaining = ref;
  let fragment: RefFragment | undefined;
  let version: string | undefined;

  // Extract fragment (after #)
  const fragmentIndex = remaining.indexOf("#");
  if (fragmentIndex !== -1) {
    const fragmentStr = remaining.slice(fragmentIndex + 1);
    remaining = remaining.slice(0, fragmentIndex);
    fragment = parseFragment(fragmentStr);
  }

  // Extract version (after @)
  const versionIndex = remaining.lastIndexOf("@");
  if (versionIndex !== -1) {
    // Make sure @ is not part of a path (e.g., not in the middle of a filename)
    const afterAt = remaining.slice(versionIndex + 1);
    // Version should look like a version string (starts with digit or has version-like pattern)
    if (/^[\d]/.test(afterAt) || /^v\d/.test(afterAt)) {
      version = afterAt;
      remaining = remaining.slice(0, versionIndex);
    }
  }

  const path = remaining;
  const isAbsolute = path.startsWith("/");

  return {
    path,
    isAbsolute,
    version,
    fragment,
    original: ref,
  };
}

/**
 * Parse a fragment string into its structure.
 */
function parseFragment(fragmentStr: string): RefFragment {
  // Check for query(...) syntax
  if (fragmentStr.startsWith("query(") && fragmentStr.endsWith(")")) {
    return {
      type: "query",
      value: fragmentStr.slice(6, -1), // Extract content between query( and )
    };
  }

  // Otherwise treat as ID
  return {
    type: "id",
    value: fragmentStr,
  };
}

export type { ParsedRef, RefFragment };
