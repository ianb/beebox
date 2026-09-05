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
  // Frozen web-page snapshots captured by beebox-clerk.
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
 * **An extension allowlist, never a path glob.** A `.attach/` scope holds
 * committed non-assets alongside assets: capture writes child `.card` files
 * into the parent scope, `manifest.json` lives there, and email bodies land as
 * `.txt`. On one production box, 1,844 tracked files sit inside `.attach/`
 * scopes. `include=*.attach/*` would annex all of them, replacing committed
 * card text with pointer files — see the classifier section of
 * docs/plans/asset-annex.md.
 *
 * **Unscoped, because git-annex replaces Git LFS here.** An earlier version
 * anchored every pattern to `.attach/`, inherited from the manifest model,
 * which only ever covered attach scopes. But boxes also run Git LFS with this
 * same extension list and *no* path scoping — on one production box that is 154
 * files, all of them legacy captures under `_content/inbox/` rather than in any
 * attach scope. Scoping annex to `.attach/` would leave those to LFS forever
 * and keep two mechanisms alive; matching LFS's scope exactly is what lets the
 * LFS filters be removed. Behavior for those paths is unchanged — they were
 * already kept out of git's object database, just by a different tool that does
 * not verify content.
 *
 * git-annex matches these globs case-sensitively, so each extension renders
 * through {@link anyCaseGlob} — the same per-character rendering the attributes
 * file uses. The two lists agreeing exactly is the point: a case this expression
 * misses does not fail safe. The filter still runs (the attributes side matches
 * any case), declines to annex, and the bytes commit as a raw git blob, which is
 * the outcome the annex migration exists to prevent. Verified 2026-08-18: under
 * a lowercase-and-uppercase-only expression `Mixed.Jpg` committed as a 1.5 MB
 * blob while `upper.JPG` and `lower.jpg` became pointers.
 */
export function assetLargefilesExpression(): string {
  return ASSET_EXTENSIONS.map((ext) => `include=*.${anyCaseGlob(ext)}`).join(" or ");
}

/**
 * First line of the managed `.git/info/attributes` block, so a human (or a
 * grep) can tell our file from git-annex's default without diffing it.
 */
export const ANNEX_ATTRIBUTES_MARKER = "# Managed by beebox — do not edit.";

/**
 * One glob segment matching `ext` in any case: `heic` → `[hH][eE][iI][cC]`.
 * Used by both renderings above and below, which is what keeps them in step.
 *
 * gitattributes patterns are matched case-sensitively (wildmatch), and so is
 * `annex.largefiles` — verified with git-annex 10.20260717: `git annex
 * matchexpression "include=*.jpg" --largefiles --file UPPER.JPG` exits 1, and
 * the same expression written `include=*.[jJ][pP][gG]` matches all three of
 * `lower.jpg`, `UPPER.JPG`, and `Mixed.Jpg`. Both renderings use this, so
 * neither can miss a case the other covers.
 */
function anyCaseGlob(ext: string): string {
  return ext
    .split("")
    .map((ch) => (ch.toUpperCase() === ch ? ch : `[${ch}${ch.toUpperCase()}]`))
    .join("");
}

/**
 * A bulk-upload batch's attach scope — the one place a NON-asset extension
 * still belongs in the annex.
 *
 * A batch lands whatever the boxholder picked (`.zip`, `.csv`, extensionless),
 * so `core/bulk-upload/prepare.ts` writes a batch-local `.gitattributes` setting
 * `* annex.largefiles=anything` over the scope. That override is inert on its
 * own: `annex.largefiles` is only consulted for a path the filter-process
 * actually sees, and the extension lines above were the whole of what it saw.
 * Between 2026-08-04 (when this file was scoped) and 2026-08-18 a batch's
 * non-asset files therefore committed as raw git blobs — verified at 1.5 MB
 * each — while its photos annexed correctly. This line makes the batch-local
 * override reachable.
 *
 * Unanchored for the same reason as {@link CAPTURE_STAGING_IGNORE_PATTERN}: a
 * batch lands under `<contextDir>/tmp-upload/`, not only the box root.
 */
export const BULK_BATCH_ATTACH_PATTERN = "**/*.upload-batch.attach/**";

/**
 * {@link ASSET_EXTENSIONS} as the contents of `.git/info/attributes` — which
 * paths git routes through the git-annex filter-process.
 *
 * **A scoped replacement for git-annex's own file.** `git annex init` writes
 * `* filter=annex` there (exactly `"\n* filter=annex\n"`), and
 * `.git/info/attributes` is the highest-precedence attributes file, so every
 * `git add` and every pathspec commit hands each path to the annex
 * filter-process — measured at ~0.3s of fixed cost per git invocation even when
 * the only file is a two-line card. Since `annex.largefiles` is purely
 * extension-based, restricting the filter to those same extensions changes
 * nothing about what gets annexed and takes text-only commits (cards,
 * manifests — every capture commit) off the filter path entirely.
 *
 * This must stay a SUPERSET of everything that can be annexed — both
 * {@link assetLargefilesExpression} and any per-directory `.gitattributes` a
 * write path lays down, which is why {@link BULK_BATCH_ATTACH_PATTERN} is here.
 * A path largefiles annexes but the filter never sees is a raw blob; a path the
 * annex holds but the filter no longer covers reads back as `/annex/objects/…`
 * text. `bbx doctor annex` enforces both halves — the file matching this
 * rendering, and every already-annexed path being covered by it.
 */
export function assetAnnexAttributes(): string {
  return [
    ANNEX_ATTRIBUTES_MARKER,
    "# Rendered from ASSET_EXTENSIONS (src/lib/asset-extensions.ts); `bbx doctor annex` restores it.",
    "# Replaces git-annex's default `* filter=annex`, which puts every text commit",
    "# through the annex filter-process for ~0.3s of nothing.",
    ...ASSET_EXTENSIONS.map((ext) => `*.${anyCaseGlob(ext)} filter=annex`),
    "# A bulk batch holds arbitrary types and widens largefiles itself; the",
    "# filter has to reach those paths for that to mean anything.",
    `${BULK_BATCH_ATTACH_PATTERN} filter=annex`,
    "",
  ].join("\n");
}

/**
 * Capture-staging media is deliberately NOT annexed: a capture is pre-triage,
 * and gets renamed, re-encoded, and EXIF-rotated before reaching its final
 * home, so annexing its bytes on arrival would mint immutable objects for
 * superseded and discarded versions. Committed metadata inside the same
 * attach scopes is re-included by the managed block writer.
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
