/**
 * Frontmatter-card ref existence check.
 *
 * Replaces cardworks' `loader.resolveRef` for the lint broken-ref walk
 * (card-lint.ts): given a ref string written in a card, resolve it to a
 * filesystem path and report whether the target exists. The card-lint
 * dispatcher already extracts the refs itself (`extractRefs` over frontmatter,
 * `extractBodyRefs` over the Markdoc body); this only answers "does it exist".
 *
 * Ref semantics (the 3-form rule) live in `src/shared/ref-path.ts` — this
 * module only turns its box-relative answer into an absolute path and asks the
 * filesystem. A ref's `?query`/`#fragment` is split off BEFORE the existence
 * check: `feedback.target.ref` is documented as `path#fragment`
 * (`src/schemas/feedback.tsx`), and handing the fragment to the filesystem
 * false-flagged those refs as broken.
 */

import { access } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseRef, resolveRefPath } from "../shared/ref-path.js";
import { containWithinBox, realpathContained, type BoxRelativePath } from "../lib/box-containment.js";
import { errnoCode } from "../lib/error-guards.js";

interface RefExistsInput {
  /** The raw ref string as written in the card. */
  ref: string;
  /** Absolute path of the card the ref was written in, or `""` for the box root. */
  fromPath: string;
  /** Absolute box root, used to resolve box-root-absolute (`/…`) refs. */
  boxRoot: string;
}

/**
 * Resolve a ref to the absolute filesystem path it points at, or `null` when it
 * names no in-box file — it escapes the box root, or its path part is empty
 * (a fragment-/query-only ref like `#risks` or `?view=x`, which used to resolve
 * to the containing directory and pass the existence check). The shared algebra
 * fails closed on both — see `src/shared/ref-path.ts`. Any `?query`/`#fragment`
 * is dropped: it addresses a location *within* the target, not a different file.
 */
export function resolveRefToPath(input: RefExistsInput): string | null {
  const fromPath = input.fromPath === "" ? "" : boxRelativeFrom(input.boxRoot, input.fromPath);
  if (fromPath === null) return null;
  const resolved = resolveRefPath({ fromPath, ref: parseRef(input.ref).path, kind: "card" });
  return resolved === null ? null : resolve(input.boxRoot, resolved);
}

/**
 * The referring card's path as the shared algebra wants it: box-relative,
 * forward slashes. A card outside the box has no in-box refs to resolve, so it
 * fails closed like an escaping ref.
 */
function boxRelativeFrom(boxRoot: string, absFromPath: string): string | null {
  const rel = relative(resolve(boxRoot), resolve(absFromPath));
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep)) return null;
  return rel.split(sep).join("/");
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
  const abs = resolveRefToPath(input);
  // `containWithinBox` is the security floor AND the only minter of the
  // `BoxRelativePath` brand — kept even though the shared algebra already
  // refuses escapes, so the branded type still traces to one checked producer.
  return abs === null ? null : containWithinBox(input.boxRoot, abs);
}

/**
 * Whether the card-to-card (or card-to-attachment) ref points at a file that
 * exists. A non-ENOENT access failure is logged and treated as "does not
 * exist" — the lint walk surfaces it as a broken-ref warning either way.
 */
export async function resolveRefExists(input: RefExistsInput): Promise<boolean> {
  const contained = resolveContainedRef(input);
  if (contained === null) {
    // A ref that escapes the box — or names nothing at all — points at no in-box
    // file. Treat it as broken (the lint walk surfaces it as a broken-ref
    // warning), never resilient.
    console.warn(
      `resolveRefExists: ref "${input.ref}" in ${input.fromPath} names no in-box file (escapes the box, or is empty)`
    );
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
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`resolveRefExists: access failed for ${target}`, e);
    }
    return false;
  }
}
