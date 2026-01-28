import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseXml } from "../parser/parse.js";
import { parseRef, parseRefs } from "./parse-ref.js";
import { executeXPath } from "./xpath.js";
import type { ResolvedRef, ParsedRef, RefFragment } from "./types.js";

/**
 * Resolve multiple references from a whitespace-separated refs string.
 *
 * @param refs - The refs attribute value (whitespace-separated references)
 * @param resolver - The resolver context
 * @returns Array of resolved references
 */
export async function resolveRefs(
  refs: string,
  resolver: RefResolver
): Promise<ResolvedRef[]> {
  const parsedRefs = parseRefs(refs);
  const results: ResolvedRef[] = [];

  for (const parsed of parsedRefs) {
    const resolved = await resolveRef(parsed.original, resolver);
    results.push(resolved);
  }

  return results;
}

/**
 * Context for resolving references.
 */
export interface RefResolver {
  /** Filesystem to use for reading files */
  fs: FileSystem;
  /** Root directory of the project */
  projectRoot: string;
  /** Path of the file containing the reference */
  currentFile: string;
}

/**
 * Resolve a reference string to its target.
 *
 * @param ref - The reference string to resolve
 * @param resolver - The resolver context
 * @returns The resolved reference result
 */
export async function resolveRef(
  ref: string,
  resolver: RefResolver
): Promise<ResolvedRef> {
  const parsed = parseRef(ref);

  // Resolve the path
  const resolvedPath = resolvePath(parsed, resolver);

  // Check if file exists
  const exists = await resolver.fs.exists(resolvedPath);

  if (!exists) {
    return {
      original: ref,
      parsed,
      resolvedPath,
      exists: false,
      error: `File not found: ${resolvedPath}`,
      versionMismatch: false,
    };
  }

  // Load and parse the target file
  let targetNode: ElementNode;
  try {
    const content = await resolver.fs.read(resolvedPath);
    targetNode = await parseXml(content, resolvedPath);
  } catch (e) {
    return {
      original: ref,
      parsed,
      resolvedPath,
      exists: true,
      error: `Failed to parse ${resolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
      versionMismatch: false,
    };
  }

  // Extract version from target
  const actualVersion = targetNode.attrs["version"];

  // Check version mismatch
  const versionMismatch =
    parsed.version !== undefined &&
    actualVersion !== undefined &&
    parsed.version !== actualVersion;

  // Resolve fragment if specified
  let fragment: ElementNode | undefined;
  let fragments: ElementNode[] | undefined;
  let fragmentError: string | undefined;
  let fragmentWarning: string | undefined;

  if (parsed.fragment) {
    const fragmentResult = resolveFragment(parsed.fragment, targetNode);

    if (fragmentResult.error) {
      fragmentError = fragmentResult.error;
    } else if (fragmentResult.warning) {
      fragmentWarning = fragmentResult.warning;
    }

    if (parsed.fragment.type === "query-all") {
      fragments = fragmentResult.nodes;
      if (fragments.length === 0 && !fragmentError) {
        fragmentWarning = `No elements matched query-all: #query-all(${parsed.fragment.value})`;
      }
    } else {
      // id or query - expect single result
      fragment = fragmentResult.nodes[0];
      if (!fragment && !fragmentError) {
        fragmentError = `Fragment not found: ${formatFragment(parsed.fragment)}`;
      }
    }
  }

  const result: ResolvedRef = {
    original: ref,
    parsed,
    resolvedPath,
    exists: true,
    requestedVersion: parsed.version,
    actualVersion,
    versionMismatch,
  };

  // Add optional fields only if defined
  if (fragment !== undefined) {
    result.fragment = fragment;
  }
  if (fragments !== undefined) {
    result.fragments = fragments;
  }
  if (fragmentError !== undefined) {
    result.fragmentError = fragmentError;
  }
  if (fragmentWarning !== undefined) {
    result.fragmentWarning = fragmentWarning;
  }

  return result;
}

/**
 * Format a fragment for error messages.
 */
function formatFragment(fragment: RefFragment): string {
  switch (fragment.type) {
    case "id":
      return `#${fragment.value}`;
    case "query":
      return `#query(${fragment.value})`;
    case "query-all":
      return `#query-all(${fragment.value})`;
  }
}

/**
 * Resolve a path from a parsed reference.
 */
function resolvePath(parsed: ParsedRef, resolver: RefResolver): string {
  if (parsed.isAbsolute) {
    // Absolute paths are relative to project root
    return resolver.projectRoot + parsed.path;
  }

  // Relative paths are resolved from current file
  return resolver.fs.resolve(resolver.currentFile, parsed.path);
}

/**
 * Result of resolving a fragment.
 */
interface FragmentResult {
  nodes: ElementNode[];
  error?: string;
  warning?: string;
}

/**
 * Resolve a fragment within a parsed document.
 */
function resolveFragment(fragment: RefFragment, root: ElementNode): FragmentResult {
  if (fragment.type === "id") {
    const node = findById(root, fragment.value);
    return { nodes: node ? [node] : [] };
  }

  // XPath query
  const expectOne = fragment.type === "query";
  const xpathResult = executeXPath(fragment.value, root, expectOne);

  const result: FragmentResult = { nodes: xpathResult.nodes };
  if (xpathResult.error !== undefined) {
    result.error = xpathResult.error;
  }
  if (xpathResult.warning !== undefined) {
    result.warning = xpathResult.warning;
  }
  return result;
}

/**
 * Find an element by its id attribute.
 */
function findById(node: ElementNode, id: string): ElementNode | undefined {
  if (node.attrs["id"] === id) {
    return node;
  }

  for (const child of node.children) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

export type { ResolvedRef };
