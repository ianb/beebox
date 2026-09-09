/**
 * The box namespace fence: whether a box-relative path lands inside an
 * underscore area (`BOX_ROOT_VOCABULARY`'s `kind: "area"` entries) — the
 * closed set every ref and HTTP surface is restricted to
 * (`docs/implemented-plans/one-root-box-layout.md` Track B).
 *
 * Dependency-free (only imports `box-root-vocabulary.ts`, itself a leaf) —
 * mirrored at `src/shared/box-namespace.ts` per `docs/module-map.md`'s
 * "frontend-consumed leaf helper" pattern, since `shared/ref-path.ts` (which
 * must stay isomorphic) needs it too.
 */
import { BOX_ROOT_VOCABULARY } from "./box-root-vocabulary.js";

const BOX_AREA_NAMES: ReadonlySet<string> = new Set(
  BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area").map((entry): string => entry.name)
);

/**
 * Whether a box-relative path (no leading slash, forward-slash separated)
 * lands inside an underscore area. The empty string — the box root itself —
 * is false: there are no ref-addressable or servable root files.
 */
export function isInBoxNamespace(relativePath: string): boolean {
  if (relativePath === "") return false;
  const first = relativePath.split("/", 1)[0];
  return first !== undefined && BOX_AREA_NAMES.has(first);
}
