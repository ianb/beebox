import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseXml } from "../parser/parse.js";
import { parseRef } from "./parse-ref.js";
import type { ResolvedRef, ParsedRef } from "./types.js";

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
  let fragmentError: string | undefined;

  if (parsed.fragment) {
    const fragmentResult = resolveFragment(parsed.fragment, targetNode);
    if (fragmentResult) {
      fragment = fragmentResult;
    } else {
      fragmentError = `Fragment not found: ${parsed.fragment.type === "id" ? "#" + parsed.fragment.value : "#query(" + parsed.fragment.value + ")"}`;
    }
  }

  return {
    original: ref,
    parsed,
    resolvedPath,
    exists: true,
    fragment,
    fragmentError,
    requestedVersion: parsed.version,
    actualVersion,
    versionMismatch,
  };
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
 * Resolve a fragment within a parsed document.
 */
function resolveFragment(
  fragment: { type: "id" | "query"; value: string },
  root: ElementNode
): ElementNode | undefined {
  if (fragment.type === "id") {
    return findById(root, fragment.value);
  }

  // Query fragments would use XPath - for now just return undefined
  // Full XPath support can be added later
  return undefined;
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
