/**
 * Identity for a capability, derived from what it IS.
 *
 * The first run identified stories by provenance — `seam-connectors-r2-02` meant "the second story
 * the seam-connectors reader emitted in round 2". That encodes which agent happened to find it, in
 * which pass, so a regeneration with different round ordering or a different dedup outcome gives
 * the same capability a different id, and anything citing the old one silently rots. (This is the
 * same trap the 2026-06-26 catalog set for its own follow-up plan, which indexes into it by item
 * number.)
 *
 * A content-derived id survives a regeneration as long as the capability is still described the
 * same way. It is not magic: reword a title and the id changes. Two things keep that honest rather
 * than silent:
 *
 *  - `aliases` on a record carries ids the story used to have, so an issue or a recheck citing an
 *    old id still resolves (see `resolveId`). `rekey.ts` populates it; a future regeneration that
 *    maps old ids to new should too.
 *  - A citation that resolves to nothing is REPORTED, not skipped — `apply-recheck.ts` warns by id
 *    rather than silently updating no story.
 *
 * What does not exist: automatic old-to-new mapping across a full regeneration. If a reworded title
 * changes an id and nobody records the alias, the link breaks and you find out from the warning.
 */

const MAX_SLUG = 50;

/** Lowercase, hyphenated, truncated at a word boundary so ids stay readable. */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (base.length <= MAX_SLUG) return base;
  const cut = base.slice(0, MAX_SLUG);
  const lastDash = cut.lastIndexOf("-");
  const trimmed = lastDash > MAX_SLUG / 2 ? cut.slice(0, lastDash) : cut;
  return trimmed.replace(/-$/u, "");
}

/**
 * `<group>/<title-slug>`, e.g. `connectors/calendar-sync-repairs-an-expired-sync-token`.
 *
 * Readable on purpose: these get cited in issue frontmatter and read in diffs, so a human should be
 * able to tell what one refers to without looking it up.
 */
export function stableId(group: string, title: string): string {
  return `${group}/${slugify(title)}`;
}

/**
 * Assign ids across a whole catalog, disambiguating any collision with a numeric suffix.
 * Order-dependent only when two stories in one group slugify identically, which is rare.
 */
export function assignIds<T extends { group: string, title: string }>(
  stories: T[],
): Map<T, string> {
  const used = new Set<string>();
  const out = new Map<T, string>();
  for (const s of stories) {
    const base = stableId(s.group, s.title);
    let id = base;
    let n = 2;
    while (used.has(id)) {
      id = `${base}-${n}`;
      n++;
    }
    used.add(id);
    out.set(s, id);
  }
  return out;
}

/** Records a catalog holds, for id resolution. */
export interface Identified { id: string, aliases?: string[] }

/**
 * Find a record by its current id or any id it used to have.
 *
 * Citations outlive titles: an issue filed today names an id that a later reword may replace, and
 * resolving only on the current id would make that citation quietly match nothing.
 */
export function resolveId<T extends Identified>(records: T[], id: string): T | undefined {
  const exact = records.find((r) => r.id === id);
  if (exact !== undefined) return exact;
  return records.find((r) => r.aliases !== undefined && r.aliases.includes(id));
}
