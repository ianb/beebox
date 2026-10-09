/**
 * Turn a landmark's pruned subtree (`prominence-index.ts`, Track B) into
 * `ResolvedLink`s in the plan's tier order: derived `entry-point` cards,
 * then derived `primary` cards, then nested landmarks — spliced into
 * `resolve.ts`'s flat list between the hand-listed `links` and `expand`
 * tiers. Split into its own module (rather than living in `resolve.ts`)
 * purely to stay under the file-length budget; never imports from
 * `resolve.ts`, so
 * `resolve.ts` can import this module without a cycle.
 *
 * A derived entry whose target can't be read (deleted between the
 * prominence-index's walk and this resolution — a small window, not the
 * common case) is dropped rather than shown as a broken link: nobody
 * authored it, so a stale generated entry pointing at nothing serves no
 * one. It's reported instead, as a `derived-read` problem; the caller
 * decides whether that's surfaced (`landmarks.list`) or just logged
 * (`forDir` — see `landmarks.ts`).
 */

import { naturalCompare } from "../../../shared/natural-sort.js";
import { buildLink, type ResolvedLink, type ResolveOptions } from "./link-build.js";
import { prunedSubtreeWith, type ProminenceEntry, type ProminenceWalkContext, type PrunedSubtree } from "../prominence-index.js";
import { createCardSchemaMap } from "../../../schemas.js";
import type { ProminenceLevel } from "../../../shared/prominence.js";
import type { DerivedReadProblem } from "../summaries.js";

export interface DerivedResolution {
  links: ResolvedLink[];
  problems: DerivedReadProblem[];
  /**
   * The derived level of each card the caller already listed (hand-listed
   * `links:`), by resolved ref. The listed row wins the dedup; this keeps the
   * card's tier, so the caller can carry it onto that row.
   */
  listedLevels: Map<string, ProminenceLevel>;
}

/**
 * Resolve `derived.entries`/`derived.nested` into links, deduped against
 * (and appended after) whatever the caller already resolved from `links:`.
 * Mutates neither `seen` input's caller-owned array; returns only the NEW
 * links this pass adds (still checked against `seen` so a card that's both
 * hand-listed and derived isn't resolved twice).
 */
export async function resolveDerivedTiers(
  derived: PrunedSubtree,
  { seen, options }: { seen: Set<string>; options: ResolveOptions },
): Promise<DerivedResolution> {
  const links: ResolvedLink[] = [];
  const problems: DerivedReadProblem[] = [];
  const listedLevels = new Map<string, ProminenceLevel>();
  for (const level of ["entry-point", "primary"] as const) {
    await addCardTier({ entries: derived.entries, level, links, seen, options, problems, listedLevels });
  }
  await addNestedLandmarkTier(derived, { links, seen, boxRoot: options.boxRoot });
  return { links, problems, listedLevels };
}

async function addCardTier(
  { entries, level, links, seen, options, problems, listedLevels }: {
    entries: ProminenceEntry[];
    level: ProminenceLevel;
    links: ResolvedLink[];
    seen: Set<string>;
    options: ResolveOptions;
    problems: DerivedReadProblem[];
    listedLevels: Map<string, ProminenceLevel>;
  },
): Promise<void> {
  const tier = entries
    .filter((e) => e.kind === "card" && e.level === level)
    .toSorted((a, b) => naturalCompare(a.boxPath, b.boxPath));
  for (const entry of tier) {
    // Dedup on the RESOLVED ref, not `entry.boxPath` — a hand-listed link's
    // ref goes through the same `buildLink`/`resolveRefPath` normalization
    // (dropping the leading "/", resolving `.`/`..`), so checking `seen`
    // before resolving would compare a normalized ref against a raw one and
    // never match.
    const resolved = await buildLink({ rawRef: entry.boxPath, label: null, source: "derived", prominence: entry.level, options });
    if (seen.has(resolved.ref)) {
      listedLevels.set(resolved.ref, entry.level);
      continue;
    }
    if (!resolved.exists) {
      problems.push({
        kind: "derived-read",
        landmarkPath: options.landmarkPath,
        path: entry.boxPath,
        message: `derived link ${entry.boxPath} could not be read`,
      });
      continue;
    }
    seen.add(resolved.ref);
    links.push(resolved);
  }
}

/**
 * One row per nested landmark. The row opens the nested place's entry-point
 * card — where a reader starts — when its own pruned subtree has one.
 * Without an entry point the row opens the landmark card, which renders as
 * the place page.
 */
async function addNestedLandmarkTier(
  { entries, nested }: PrunedSubtree,
  { links, seen, boxRoot }: { links: ResolvedLink[]; seen: Set<string>; boxRoot: string },
): Promise<void> {
  const sorted = nested.toSorted((a, b) => naturalCompare(a.path, b.path));
  // Built once, and only when there is a nested landmark to look into.
  const cardSchemas = sorted.length > 0 ? await createCardSchemaMap(boxRoot) : null;
  for (const n of sorted) {
    // `n.path` has no leading "/" (box-relative, matching every other
    // resolved ref's format) — see the comment in `addCardTier` above.
    if (seen.has(n.path)) continue;
    const entryPoint = cardSchemas === null ? null : await nestedEntryPoint({ boxRoot, cardSchemas }, n.dir);
    if (entryPoint !== null && seen.has(entryPoint)) continue;
    const entry = entries.find((e) => e.kind === "landmark" && e.boxPath === `/${n.path}`);
    seen.add(n.path);
    if (entryPoint !== null) seen.add(entryPoint);
    links.push({
      ref: entryPoint ?? n.path,
      label: n.label,
      title: n.label,
      exists: true,
      source: "place",
      ...(entry?.kind === "landmark" ? { prominence: entry.level } : {}),
    });
  }
}

/** The first (natural order) `entry-point` card in a nested landmark's own pruned subtree, box-relative without a leading "/". */
async function nestedEntryPoint(
  ctx: ProminenceWalkContext,
  dir: string,
): Promise<string | null> {
  const sub = await prunedSubtreeWith(ctx, dir);
  const first = sub.entries
    .filter((e) => e.kind === "card" && e.level === "entry-point")
    .map((e) => e.boxPath.slice(1))
    .toSorted(naturalCompare)[0];
  return first ?? null;
}
