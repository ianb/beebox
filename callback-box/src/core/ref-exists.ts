/**
 * Frontmatter-card ref existence check.
 *
 * Replaces cardworks' `loader.resolveRef` for the lint broken-ref walk
 * (card-lint.ts): given a ref string written in a card, resolve it to a
 * filesystem path and report whether the target exists. The card-lint
 * dispatcher already extracts the refs itself (`extractRefs` over frontmatter,
 * `extractBodyRefs` over the Markdoc body); this only answers "does it exist".
 *
 * Mirrors cardworks' ref semantics (refs/parse-ref.ts + refs/resolve.ts) so the
 * broken-ref warnings match what the XML loader produced:
 *  - a `#fragment` suffix is ignored for existence
 *  - an `@version`-like suffix (`@1.2.3`, `@v2`) is stripped before resolving
 *    (a bare `@` mid-filename is left alone)
 *  - box-root-absolute refs (`/box/…`) resolve against the box root
 *  - `attach/<rest>` (and bare `attach`) resolve into the referring card's
 *    `<basename>.attach/` scope
 *  - everything else resolves relative to the referring card's directory
 */

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isAttachRef, resolveAttachRef } from "../shared/attach-path.js";

interface RefExistsInput {
  /** The raw ref string as written in the card (may carry `@version`/`#fragment`). */
  ref: string;
  /** Absolute path of the card the ref was written in. */
  fromPath: string;
  /** Absolute box root, used to resolve box-root-absolute (`/…`) refs. */
  boxRoot: string;
}

/**
 * Strip the `@version` and `#fragment` suffixes, returning the bare path
 * component — the same split cardworks' parseRef performs. The version is only
 * stripped when it looks version-like (`@1.x`, `@v2`), so an `@` inside a
 * filename isn't mistaken for a version delimiter.
 */
function refPathComponent(ref: string): string {
  let remaining = ref;
  const hashIndex = remaining.indexOf("#");
  if (hashIndex !== -1) remaining = remaining.slice(0, hashIndex);
  const atIndex = remaining.lastIndexOf("@");
  if (atIndex !== -1) {
    const afterAt = remaining.slice(atIndex + 1);
    if (/^v?\d/.test(afterAt)) remaining = remaining.slice(0, atIndex);
  }
  return remaining;
}

/** Resolve a ref to the absolute filesystem path it points at. */
export function resolveRefToPath(input: RefExistsInput): string {
  const refPath = refPathComponent(input.ref);
  if (refPath.startsWith("/")) return input.boxRoot + refPath;
  if (isAttachRef(refPath)) {
    const attachResolved = resolveAttachRef(input.fromPath, refPath);
    if (attachResolved !== null) return attachResolved;
  }
  return resolve(dirname(input.fromPath), refPath);
}

/**
 * Whether the card-to-card (or card-to-attachment) ref points at a file that
 * exists. A non-ENOENT access failure is logged and treated as "does not
 * exist" — the lint walk surfaces it as a broken-ref warning either way.
 */
export async function resolveRefExists(input: RefExistsInput): Promise<boolean> {
  const target = resolveRefToPath(input);
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
