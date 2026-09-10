/**
 * Absolute-machine-path guard for card content (Track B,
 * `docs/implemented-plans/one-root-box-layout.md`): a card body or frontmatter that
 * embeds a real developer's home directory (`/Users/<name>/…`,
 * `/home/<name>/…`) leaks a machine-specific path into content that's meant
 * to be portable across boxes and machines — the same failure mode the
 * monorepo's `bin/path-leak-check.ts` guards docs/source against, applied
 * here to box content at `bbx validate` time.
 *
 * Same allowlist shape as `path-leak-check.ts` on purpose (fictional
 * placeholders + `/Users/me`/`/Users/you` for `file:` URL examples) — not
 * shared code (that guard is a monorepo dev-tool script outside `beebox/`'s
 * own dependency graph), but the same convention so the two don't drift in
 * spirit.
 */

/** Names that are NOT a personal-machine-path leak — placeholders only. */
const ALLOWED_ABSOLUTE_PATH_NAMES = new Set(["me", "you", "user", "x"]);

/** A real home path: `/Users/<name>/` or `/home/<name>/`, capturing the name. */
const HOME_PATH = /\/(?:Users|home)\/([\dA-Za-z][\w.-]*)\//g;

/**
 * Every real (non-allowlisted) absolute machine path found in `text`, as the
 * matched `/Users/<name>/` (or `/home/<name>/`) prefix. Empty when the text
 * carries none.
 */
export function findAbsoluteMachinePaths(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(HOME_PATH)) {
    const name = match[1];
    if (name === undefined || ALLOWED_ABSOLUTE_PATH_NAMES.has(name)) continue;
    found.push(match[0]);
  }
  return found;
}
