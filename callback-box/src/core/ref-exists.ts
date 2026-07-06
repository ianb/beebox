/**
 * Frontmatter-card ref existence check.
 *
 * Replaces cardworks' `loader.resolveRef` for the lint broken-ref walk
 * (card-lint.ts): given a ref string written in a card, resolve it to a
 * filesystem path and report whether the target exists. The card-lint
 * dispatcher already extracts the refs itself (`extractRefs` over frontmatter,
 * `extractBodyRefs` over the Markdoc body); this only answers "does it exist".
 *
 * Ref semantics:
 *  - box-root-absolute refs (`/box/…`) resolve against the box root
 *  - `attach/<rest>` (and bare `attach`) resolve into the referring card's
 *    `<basename>.attach/` scope
 *  - everything else resolves relative to the referring card's directory
 */

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isAttachRef, resolveAttachRef } from "../shared/attach-path.js";
import { containWithinBox, realpathContained, type BoxRelativePath } from "../lib/box-containment.js";

interface RefExistsInput {
  /** The raw ref string as written in the card. */
  ref: string;
  /** Absolute path of the card the ref was written in. */
  fromPath: string;
  /** Absolute box root, used to resolve box-root-absolute (`/…`) refs. */
  boxRoot: string;
}

/** Resolve a ref to the absolute filesystem path it points at. */
export function resolveRefToPath(input: RefExistsInput): string {
  const refPath = input.ref;
  if (refPath.startsWith("/")) return input.boxRoot + refPath;
  if (isAttachRef(refPath)) {
    const attachResolved = resolveAttachRef(input.fromPath, refPath);
    if (attachResolved !== null) return attachResolved;
  }
  return resolve(dirname(input.fromPath), refPath);
}

/**
 * Resolve a card ref through the canonical three-form semantics
 * (box-root-absolute `/…`, `attach/…`, else document-relative to `fromPath`)
 * AND contain it: returns a branded box-relative path, or `null` if the ref
 * escapes the box. The single producer of `BoxRelativePath` for
 * canonically-resolved refs — an escaping ref must be treated exactly like a
 * nonexistent one at every call site.
 */
export function resolveContainedRef(input: RefExistsInput): BoxRelativePath | null {
  return containWithinBox(input.boxRoot, resolveRefToPath(input));
}

/**
 * Whether the card-to-card (or card-to-attachment) ref points at a file that
 * exists. A non-ENOENT access failure is logged and treated as "does not
 * exist" — the lint walk surfaces it as a broken-ref warning either way.
 */
export async function resolveRefExists(input: RefExistsInput): Promise<boolean> {
  const contained = resolveContainedRef(input);
  if (contained === null) {
    // A ref that escapes the box points at no in-box file — treat it as broken
    // (the lint walk surfaces it as a broken-ref warning), never resilient.
    console.warn(`resolveRefExists: ref "${input.ref}" in ${input.fromPath} escapes the box`);
    return false;
  }
  // `access` follows symlinks, so re-verify via realpath: an in-box symlink
  // pointing outside must not be reported as an existing (valid) ref.
  const safe = await realpathContained(input.boxRoot, contained);
  if (safe === null) {
    console.warn(`resolveRefExists: ref "${input.ref}" in ${input.fromPath} resolves outside the box via symlink`);
    return false;
  }
  const target = resolve(input.boxRoot, safe);
  try {
    await access(target);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`resolveRefExists: access failed for ${target}`, e);
    }
    return false;
  }
}
