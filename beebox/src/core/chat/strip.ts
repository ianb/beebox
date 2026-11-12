/**
 * Resolve the card `bbx chat strip set` names (`docs/implemented-plans/conversation-strip.md`).
 *
 * The ref goes through `parseRef` / `resolveRefPath` only, so a `..` escape or
 * a path outside the box namespace fails closed. The card type comes from the
 * filename. A type is accepted when a built-in renderer draws it in the strip
 * or a box view bound to it lists `"strip"` in its `modes`.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { typeFromFilename } from "../card-io.js";
import { realpathContained, containWithinBox } from "../../lib/box-containment.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path/core.js";
import { err, ok, type Result } from "../../shared/result.js";
import { BUILTIN_STRIP_TYPES, isBuiltinStripType, stripViewFor, type StripViewCandidate } from "../../shared/strip-types.js";

export type StripRefusal = "not-found" | "not-a-card" | "not-strip-capable";

export interface StripCard {
  /** The box path with a leading `/`: the stored feature value. */
  path: string;
  type: string;
}

export interface StripRefusalDetail {
  refusal: StripRefusal;
  /** The card type, when the refusal is `not-strip-capable`. */
  type?: string;
  /** Strip-capable types in this box, when the refusal is `not-strip-capable`. */
  capableTypes?: string[];
}

/** Types a card may take in the strip in this box: built-ins plus types a strip view renders. */
export function stripCapableTypes(metas: readonly StripViewCandidate[]): string[] {
  const types = new Set<string>(BUILTIN_STRIP_TYPES);
  for (const meta of metas) {
    if (!meta.modes.includes("strip")) continue;
    for (const type of meta.rendersCardTypes) types.add(type);
  }
  return [...types].toSorted();
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch (_e) {
    // Any stat failure (ENOENT, EACCES) means there is no card to show.
    return false;
  }
}

/** The human message the route and the CLI show for a refusal. */
export function stripRefusalMessage(ref: string, detail: StripRefusalDetail): string {
  switch (detail.refusal) {
    case "not-found":
      return `no card at ${ref}`;
    case "not-a-card":
      return `${ref} is not a card`;
    case "not-strip-capable":
      return `${detail.type ?? "this"} cards cannot be shown in the strip; strip-capable types in this box: ${(detail.capableTypes ?? []).join(", ")}`;
  }
}

export async function resolveStripCard(
  boxRoot: string,
  { ref, metas }: { ref: string; metas: readonly StripViewCandidate[] },
): Promise<Result<StripCard, StripRefusalDetail>> {
  const rel = resolveRefPath({ fromPath: undefined, ref: parseRef(ref).path, kind: "write-target" });
  if (rel === null) return err({ refusal: "not-found" });
  const type = typeFromFilename(rel);
  if (type === undefined || !rel.endsWith(".card")) return err({ refusal: "not-a-card" });
  const contained = containWithinBox(boxRoot, join(boxRoot, rel));
  if (contained === null) return err({ refusal: "not-found" });
  const safe = await realpathContained(boxRoot, contained);
  if (safe === null || !(await isFile(join(boxRoot, safe)))) return err({ refusal: "not-found" });
  if (!isBuiltinStripType(type) && stripViewFor(metas, type) === null) {
    return err({ refusal: "not-strip-capable", type, capableTypes: stripCapableTypes(metas) });
  }
  return ok({ path: `/${rel}`, type });
}
