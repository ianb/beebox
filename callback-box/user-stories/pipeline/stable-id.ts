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
 * same way. It is not magic: reword a title and the id changes. But that break is *visible* — the
 * old id disappears from the catalog instead of silently pointing at some unrelated story — and
 * `aliases` carries prior ids forward when a rename is known.
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
