/**
 * Round-9 hardening (aged-box rehearsal, 2026-09) — split out of
 * `one-root-ref-rewrite.ts` purely to keep that file under the repo's
 * 300-line budget.
 *
 * A BARE v2 ref (no leading `/`) is ambiguous: old system-written code wrote
 * box-root-intent refs this way (`box/inbox/email/x.card` in a card living
 * elsewhere), but the same bare shape is also the ordinary document-relative
 * form. `resolveV2Ref` alone can't tell them apart — it always resolves
 * document-relatively, which for a box-root-intent ref produces garbage like
 * `_bookkeeping/jobs/box/inbox/email/x.card`. This module picks the reading
 * a bare ref actually meant, using the pre-migration existence snapshot the
 * caller hands in (`oldPathExists`) — mirroring `canonical-refs.ts`'s
 * `--fix` box-root-intent rescue, but against the OLD v2 tree instead of the
 * live v3 one.
 *
 * It also classifies a ref that resolves to NOTHING under either reading as
 * "pre-broken" — already dangling before this migration touched anything
 * (an aged box's stale job-card refs to long-consumed content are the
 * motivating case). The hard link gate (`one-root-link-gate.ts`) uses that
 * flag to carry a pre-existing broken ref through the migration instead of
 * blocking the commit on it, while still blocking on a ref the migration
 * itself broke.
 */

/** v2 top-level area names a bare ref's first segment is checked against
 * when NEITHER reading resolves pre-migration — a legacy system-written ref
 * in this shape meant box-root addressing even though its target is long
 * gone, so the box-root structural mapping is preferred over the
 * document-relative garbage a naive rewrite would otherwise produce. */
const V2_AREA_INTENT_SEGMENTS = new Set(["box", "store", "config", "people", "places", "docs"]);

function isV2AreaIntentSegment(refPath: string): boolean {
  const slash = refPath.indexOf("/");
  const seg = slash === -1 ? refPath : refPath.slice(0, slash);
  return V2_AREA_INTENT_SEGMENTS.has(seg);
}

export interface RefTargetClassification {
  /** The v2 content-relative target to map through `mapV2Path`, or `null`
   * when nothing (neither reading) resolves to an in-box path at all. */
  target: string | null;
  /** Whether `target` was already dangling in the PRE-migration tree — not
   * something this migration broke. */
  preBroken: boolean;
}

/**
 * Pick which reading of one ref to use, and whether it's pre-broken.
 *
 * `docTarget`/`rootTarget` are the ref's two possible v2 content-relative
 * resolutions (document-relative and box-root, respectively — the caller
 * computes both via `resolveV2Ref`, since only it knows the referring
 * document's own path). `isBare` is false for a ref already written
 * box-root-relative (leading `/`) — there `rootTarget` is unused, since
 * there's no reading to disambiguate.
 */
export function classifyRefTarget(params: {
  isBare: boolean;
  refPath: string;
  docTarget: string | null;
  rootTarget: string | null;
  oldPathExists: (v2ContentRelPath: string) => boolean;
}): RefTargetClassification {
  const { isBare, refPath, docTarget, rootTarget, oldPathExists } = params;

  if (!isBare) {
    return { target: docTarget, preBroken: docTarget !== null && !oldPathExists(docTarget) };
  }

  const docExists = docTarget !== null && oldPathExists(docTarget);
  if (docExists) return { target: docTarget, preBroken: false };

  const rootExists = rootTarget !== null && oldPathExists(rootTarget);
  if (rootExists) return { target: rootTarget, preBroken: false };

  // Neither reading resolved pre-migration — genuinely pre-broken. Still
  // prefer the box-root-intent mapping when the ref LOOKS box-root-intent
  // (its first segment names a v2 area) — `mapV2Path`'s per-area switches
  // don't check existence, so this still maps to something structurally
  // sane, rather than the document-relative reading's garbage.
  const target = isV2AreaIntentSegment(refPath) && rootTarget !== null ? rootTarget : docTarget;
  return { target, preBroken: true };
}
