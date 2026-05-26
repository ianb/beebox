import type { ElementNode } from "../parser/provenance.js";

/**
 * Fragment specifier in a reference.
 */
export interface RefFragment {
  /** Type of fragment: 'id' for #elementId, 'query' for #query(...), 'query-all' for #query-all(...) */
  type: "id" | "query" | "query-all";
  /** The fragment value (ID or XPath query) */
  value: string;
}

/**
 * Parsed reference structure.
 */
export interface ParsedRef {
  /** The path component (relative or absolute) */
  path: string;
  /** Whether the path is absolute (starts with /) */
  isAbsolute: boolean;
  /** Optional version specifier (after @) */
  version?: string | undefined;
  /** Optional fragment specifier (after #) */
  fragment?: RefFragment | undefined;
  /** The original reference string */
  original: string;
}

/**
 * Result of resolving a reference.
 */
export interface ResolvedRef {
  /** The original reference string */
  original: string;
  /** The parsed reference */
  parsed: ParsedRef;
  /** The fully resolved path */
  resolvedPath: string;
  /** Whether the target file exists */
  exists: boolean;
  /** Error message if file doesn't exist */
  error?: string | undefined;
  /** The resolved fragment element (for #id or #query()) */
  fragment?: ElementNode | undefined;
  /** The resolved fragment elements (for #query-all()) */
  fragments?: ElementNode[] | undefined;
  /** Error if fragment was specified but not found */
  fragmentError?: string | undefined;
  /** Warning about fragment resolution (e.g., multiple matches for #query) */
  fragmentWarning?: string | undefined;
  /** Version specified in the reference */
  requestedVersion?: string | undefined;
  /** Actual version found in the target file */
  actualVersion?: string | undefined;
  /** Whether there's a version mismatch */
  versionMismatch: boolean;
}
