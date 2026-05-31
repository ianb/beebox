import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { resolveRef } from "../refs/resolve.js";
import { parseRef } from "../refs/parse-ref.js";
import { relative, relativePath } from "./path-utils.js";
import type { CardReference } from "./types.js";

/**
 * Context shared by the reference-traversal helpers: the filesystem and the
 * project root used to resolve references.
 */
export interface RefTraversalContext {
  fs: FileSystem;
  projectRoot: string;
}

/**
 * Options for {@link collectRefsFromNode}.
 */
export interface CollectRefsOptions {
  ctx: RefTraversalContext;
  cardPath: string;
}

/**
 * Collect all references from a node tree.
 */
export async function collectRefsFromNode(
  node: ElementNode,
  { ctx, cardPath }: CollectRefsOptions
): Promise<CardReference[]> {
  const results: CardReference[] = [];

  // Check ref attribute (single reference)
  const refAttr = node.attrs["ref"];
  if (refAttr) {
    const ref = await makeCardReference(refAttr, {
      ctx,
      fromPath: cardPath,
      elementTagName: node.tagName,
      attributeName: "ref",
    });
    if (ref) {
      results.push(ref);
    }
  }

  // Check refs attribute (multiple references)
  const refsAttr = node.attrs["refs"];
  if (refsAttr) {
    const refStrings = refsAttr.split(/\s+/).filter((s) => s.length > 0);
    for (const refStr of refStrings) {
      const ref = await makeCardReference(refStr, {
        ctx,
        fromPath: cardPath,
        elementTagName: node.tagName,
        attributeName: "refs",
      });
      if (ref) {
        results.push(ref);
      }
    }
  }

  // Recursively collect from children
  for (const child of node.children) {
    const childRefs = await collectRefsFromNode(child, { ctx, cardPath });
    results.push(...childRefs);
  }

  return results;
}

/**
 * Options for {@link makeCardReference}.
 */
interface MakeCardReferenceOptions {
  ctx: RefTraversalContext;
  fromPath: string;
  elementTagName: string;
  attributeName: "ref" | "refs";
}

/**
 * Create a CardReference from a reference string.
 */
async function makeCardReference(
  refStr: string,
  { ctx, fromPath, elementTagName, attributeName }: MakeCardReferenceOptions
): Promise<CardReference | undefined> {
  try {
    const parsed = parseRef(refStr);
    const resolved = await resolveRef(refStr, {
      fs: ctx.fs,
      projectRoot: ctx.projectRoot,
      currentFile: fromPath,
    });

    // Build the reference object
    const ref: CardReference = {
      fromPath,
      toPath: resolved.resolvedPath,
      refString: refStr,
      elementTagName,
      attributeName,
    };

    // Add optional properties only if defined
    if (parsed.version !== undefined) {
      ref.version = parsed.version;
    }

    if (parsed.fragment) {
      if (parsed.fragment.type === "query") {
        ref.fragment = `query(${parsed.fragment.value})`;
      } else {
        ref.fragment = parsed.fragment.value;
      }
    }

    return ref;
  } catch (_e) {
    // Intentionally ignored: an unparseable/unresolvable ref string is not a
    // reference we can report, so skip it.
    return undefined;
  }
}

/**
 * Options describing a ref-rewriting pass over a node tree as part of a move:
 * the traversal context, the card being rewritten, and the old/new paths.
 */
export interface UpdateRefsOptions {
  ctx: RefTraversalContext;
  cardPath: string;
  oldPath: string;
  newPath: string;
}

/**
 * Update refs in a node tree that point to the moved file.
 * Returns the number of refs updated.
 */
export async function updateRefsInNode(
  node: ElementNode,
  options: UpdateRefsOptions
): Promise<number> {
  let updated = 0;

  // Check this node's ref attribute (single reference)
  const refAttr = node.attrs["ref"];
  if (refAttr) {
    const newRef = await updateSingleRef(refAttr, options);
    if (newRef !== refAttr) {
      node.attrs["ref"] = newRef;
      updated++;
    }
  }

  // Check this node's refs attribute (multiple references)
  const refsAttr = node.attrs["refs"];
  if (refsAttr) {
    const refStrings = refsAttr.split(/\s+/).filter((s) => s.length > 0);
    const updatedRefs: string[] = [];
    let anyUpdated = false;

    for (const refStr of refStrings) {
      const newRef = await updateSingleRef(refStr, options);
      updatedRefs.push(newRef);
      if (newRef !== refStr) {
        anyUpdated = true;
        updated++;
      }
    }

    if (anyUpdated) {
      node.attrs["refs"] = updatedRefs.join(" ");
    }
  }

  // Recursively check children
  for (const child of node.children) {
    updated += await updateRefsInNode(child, options);
  }

  return updated;
}

/**
 * Update a single reference if it points to the moved file.
 * Returns the updated reference string (or original if not updated).
 */
async function updateSingleRef(
  refStr: string,
  { ctx, cardPath, oldPath, newPath }: UpdateRefsOptions
): Promise<string> {
  const parsed = parseRef(refStr);
  const resolved = await resolveRef(refStr, {
    fs: ctx.fs,
    projectRoot: ctx.projectRoot,
    currentFile: cardPath,
  });

  // Check if this ref points to the file being moved
  if (resolved.resolvedPath === oldPath) {
    // Compute new path, preserving absolute vs relative style
    let newRef: string;
    if (parsed.isAbsolute) {
      // Preserve absolute ref style - path from project root
      newRef = "/" + relative(ctx.projectRoot, newPath);
    } else {
      // Compute relative path from card to new location
      newRef = relativePath(cardPath, newPath);
    }
    if (parsed.version) {
      newRef += `@${parsed.version}`;
    }
    if (parsed.fragment) {
      if (parsed.fragment.type === "query") {
        newRef += `#query(${parsed.fragment.value})`;
      } else {
        newRef += `#${parsed.fragment.value}`;
      }
    }

    return newRef;
  }

  return refStr;
}
