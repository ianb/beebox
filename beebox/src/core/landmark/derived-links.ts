/**
 * Turn a landmark's pruned subtree (`prominence-index.ts`, Track B) into
 * `ResolvedLink`s in the plan's tier order: derived `entry-point` cards,
 * then derived `primary` cards, then nested landmarks — spliced into
 * `resolve.ts`'s flat list between the hand-listed `links` and `expand`
 * tiers. Split into its own module (rather than living in `resolve.ts`)
 * purely to stay under the file-length budget; imports only from
 * `link-build.ts` and `prominence-index.ts`, never from `resolve.ts`, so
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

import { naturalCompare } from "../../lib/natural-sort.js";
import { buildLink, type ResolvedLink, type ResolveOptions } from "./link-build.js";
import type { ProminenceEntry, PrunedSubtree } from "./prominence-index.js";
import type { ProminenceLevel } from "../../shared/prominence.js";
import type { DerivedReadProblem } from "./summaries.js";

export interface DerivedResolution {
  links: ResolvedLink[];
  problems: DerivedReadProblem[];
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
  for (const level of ["entry-point", "primary"] as const) {
    await addCardTier({ entries: derived.entries, level, links, seen, options, problems });
  }
  addNestedLandmarkTier(derived, { links, seen });
  return { links, problems };
}

async function addCardTier(
  { entries, level, links, seen, options, problems }: {
    entries: ProminenceEntry[];
    level: ProminenceLevel;
    links: ResolvedLink[];
    seen: Set<string>;
    options: ResolveOptions;
    problems: DerivedReadProblem[];
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
    if (seen.has(resolved.ref)) continue;
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

function addNestedLandmarkTier(
  { entries, nested }: PrunedSubtree,
  { links, seen }: { links: ResolvedLink[]; seen: Set<string> },
): void {
  const sorted = nested.toSorted((a, b) => naturalCompare(a.path, b.path));
  for (const n of sorted) {
    // `n.path` has no leading "/" (box-relative, matching every other
    // resolved ref's format) — see the comment in `addCardTier` above.
    if (seen.has(n.path)) continue;
    const entry = entries.find((e) => e.kind === "landmark" && e.boxPath === `/${n.path}`);
    seen.add(n.path);
    links.push({
      ref: n.path,
      label: n.label,
      title: n.label,
      exists: true,
      source: "derived",
      ...(entry?.kind === "landmark" ? { prominence: entry.level } : {}),
    });
  }
}
