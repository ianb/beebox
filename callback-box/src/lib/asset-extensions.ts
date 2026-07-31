/**
 * What counts as an *asset* — the binary subset of attachments whose bytes are
 * kept out of git's object database.
 *
 * One list, several renderings. It previously lived in
 * `core/commands/attachments-gitignore.ts`, which made it look like a
 * gitignore detail; it is really the definition of asset identity, and it now
 * feeds both the `.gitignore` patterns and the git-annex `annex.largefiles`
 * expression. Keeping the renderers together is the point: a split between
 * "what git skips" and "what gets annexed" is exactly the drift that let 41 MB
 * `page.frozen` snapshots into box history before 2026-07-19.
 */

/**
 * Extensions treated as assets inside `.attach/` scopes. THE list.
 *
 * An omission here means the bytes get committed to git directly. That is a
 * real failure mode, not a theoretical one — see the `frozen` entry. The
 * unlisted-binary guard (`src/core/annex/unlisted-binaries.ts`) exists to make
 * the next omission loud instead of silent.
 */
export const ASSET_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "heic",
  "tif",
  "tiff",
  "gif",
  "webm",
  "mp3",
  "m4a",
  "wav",
  "pdf",
  "mp4",
  "mov",
  // Frozen web-page snapshots captured by callback-clerk.
  "frozen",
];

/** The `.gitignore` lines for {@link ASSET_EXTENSIONS}. */
export function assetGitignorePatterns(): string {
  return ASSET_EXTENSIONS.map((ext) => `**/*.attach/**/*.${ext}`).join("\n");
}

/**
 * {@link ASSET_EXTENSIONS} as a git-annex `annex.largefiles` expression — which
 * files `git add` routes into the annex instead of committing their bytes.
 *
 * **This must stay an extension allowlist, not a path glob.** A `.attach/`
 * scope holds committed non-assets alongside assets: capture writes child
 * `.card` files into the parent scope, `manifest.json` lives there, and email
 * bodies land as `.txt`. On one production box, 1,844 tracked files sit inside
 * `.attach/` scopes. `include=*.attach/*` would annex all of them, replacing
 * committed card text with pointer files — see the classifier section of
 * docs/plans/asset-annex.md.
 *
 * git-annex globs let `*` cross `/`, so the mid-pattern `.attach/` anchors the
 * match to a scope while still reaching nested child scopes and plain
 * subdirectories; no `**` is needed (git-annex does not treat it specially).
 */
export function assetLargefilesExpression(): string {
  return ASSET_EXTENSIONS.map((ext) => `include=*.attach/*.${ext}`).join(" or ");
}

/**
 * Capture staging is deliberately NOT annexed: a capture is pre-triage, and
 * gets renamed, re-encoded, and EXIF-rotated before reaching its final home,
 * so annexing on arrival would mint immutable objects for superseded and
 * discarded versions. Keeping the staging area gitignored is the whole
 * mechanism — a gitignored file never reaches the annex.
 *
 * Unanchored on purpose: delivery targets `<contextDir>/tmp-capture/`, not
 * only the box root, so a root-anchored rule would miss real captures and
 * annex them on arrival.
 */
export const CAPTURE_STAGING_IGNORE_PATTERN = "**/tmp-capture/**/*.attach/**";

/** Does this path look like an asset by extension? Case-insensitive. */
export function isAssetExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return ASSET_EXTENSIONS.includes(filePath.slice(dot + 1).toLowerCase());
}
