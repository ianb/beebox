// # Asset classifier — `annex.largefiles`
//
// `ASSET_EXTENSIONS` is the single source of truth for what counts as
// an asset. It renders into `.gitignore` patterns today and, under git-annex,
// into an `annex.largefiles` expression deciding what `git add` routes into the
// annex. See `src/lib/asset-extensions.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  ASSET_EXTENSIONS,
  assetAnnexAttributes,
  assetGitignorePatterns,
  assetLargefilesExpression,
  BULK_BATCH_ATTACH_PATTERN,
  LEGACY_BULK_BATCH_ATTACH_PATTERN,
  CAPTURE_STAGING_IGNORE_PATTERN,
} from "../../src/lib/asset-extensions.js";

// Both renderers walk the same list, so an extension can never be ignored but
// un-annexed (or the reverse) — the drift that let 41 MB `.frozen` pages into box
// history came from exactly that kind of split:
void test("Both renderers walk the same list, so an extension can never be ignored but u...", async (t) => {
  t.check(ASSET_EXTENSIONS, [
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
    "frozen",
  ]);

  t.check(assetGitignorePatterns().split("\n"), [
    "**/*.attach/**/*.jpg",
    "**/*.attach/**/*.jpeg",
    "**/*.attach/**/*.png",
    "**/*.attach/**/*.webp",
    "**/*.attach/**/*.avif",
    "**/*.attach/**/*.heic",
    "**/*.attach/**/*.tif",
    "**/*.attach/**/*.tiff",
    "**/*.attach/**/*.gif",
    "**/*.attach/**/*.webm",
    "**/*.attach/**/*.mp3",
    "**/*.attach/**/*.m4a",
    "**/*.attach/**/*.wav",
    "**/*.attach/**/*.pdf",
    "**/*.attach/**/*.mp4",
    "**/*.attach/**/*.mov",
    "**/*.attach/**/*.frozen",
  ]);

  t.check(assetLargefilesExpression().split(" or "), [
    "include=*.[jJ][pP][gG]",
    "include=*.[jJ][pP][eE][gG]",
    "include=*.[pP][nN][gG]",
    "include=*.[wW][eE][bB][pP]",
    "include=*.[aA][vV][iI][fF]",
    "include=*.[hH][eE][iI][cC]",
    "include=*.[tT][iI][fF]",
    "include=*.[tT][iI][fF][fF]",
    "include=*.[gG][iI][fF]",
    "include=*.[wW][eE][bB][mM]",
    "include=*.[mM][pP]3",
    "include=*.[mM]4[aA]",
    "include=*.[wW][aA][vV]",
    "include=*.[pP][dD][fF]",
    "include=*.[mM][pP]4",
    "include=*.[mM][oO][vV]",
    "include=*.[fF][rR][oO][zZ][eE][nN]",
  ]);
});

// The expression is an extension allowlist, **unscoped** — it matches a binary
// anywhere, not only inside `.attach/`. That is deliberate: git-annex replaces Git
// LFS, which was itself unscoped, and anchoring to `.attach/` would strand LFS's
// content (legacy captures under `_content/inbox/`) with no mechanism at all.
void test("The expression is an extension allowlist, unscoped — it matches a binary anyw...", async (t) => {
  const terms = assetLargefilesExpression().split(" or ");
  t.check(terms.slice(0, 2), ["include=*.[jJ][pP][gG]", "include=*.[jJ][pP][eE][gG]"]);
  t.check(terms.filter((term) => term.includes("frozen") || term.includes("[fF][rR][oO][zZ][eE][nN]")), [
    "include=*.[fF][rR][oO][zZ][eE][nN]",
  ]);
  t.check(terms.filter((term) => term.includes(".attach/")), []);
});

// git-annex's globs are case-sensitive, and cameras produce all-uppercase
// extensions while file managers and scanner apps produce mixed ones. Every
// extension therefore renders through the same per-character any-case glob the
// attributes file uses, so the two lists match exactly the same paths.
//
// An earlier version emitted only the lowercase and all-uppercase spellings and
// left mixed case to the wider attributes filter, on the reasoning that an
// over-wide attribute line is harmless. It is not: the filter runs, finds no
// largefiles match, and the bytes commit as a raw git blob. Verified 2026-08-18 on
// a real annex box — `Mixed.Jpg` landed as a 1.5 MB blob beside 102-byte pointers
// for `lower.jpg` and `upper.JPG`.
void test("git-annex's globs are case-sensitive, and cameras produce all-uppercase exten...", async (t) => {
  const terms = assetLargefilesExpression().split(" or ");
  t.check(terms.filter((term) => term.includes("[hH][eE][iI][cC]")), ["include=*.[hH][eE][iI][cC]"]);
  t.check(terms.filter((term) => term === "include=*.heic" || term === "include=*.HEIC"), []);
});

// **It must not become a bare path glob.** A `.attach/` scope holds committed
// non-assets alongside assets — capture writes child `.card` files into the
// parent scope, `manifest.json` lives there, and email bodies land as `.txt`. On
// one production box 1,844 tracked files sit inside `.attach/` scopes, so
// `include=*.attach/*` would replace committed card text with annex pointers:
//
// Unscoped is safe precisely because it is an *extension* allowlist: cards,
// manifests, and email bodies never match, wherever they live.
void test("It must not become a bare path glob. A .attach/ scope holds committed non-ass...", async (t) => {
  const terms = assetLargefilesExpression().split(" or ");
  t.check(terms.filter((term) => /\.(card|json|md|txt)$/i.test(term)), []);
});

// ## `.git/info/attributes` — which paths reach the annex filter
//
// The third rendering: what git hands to the git-annex filter-process. git-annex
// itself writes `* filter=annex` there, so a commit of two text cards pays ~0.3s
// of filter startup for nothing. Since `annex.largefiles` is purely
// extension-based, the filter is scoped to the same extensions:
void test("The third rendering:", async (t) => {
  // doctest:L90
  await t.checkText(assetAnnexAttributes(), `# Managed by beebox — do not edit.
# Rendered from ASSET_EXTENSIONS (src/lib/asset-extensions.ts); \`bbx doctor annex\` restores it.
# Replaces git-annex's default \`* filter=annex\`, which puts every text commit
# through the annex filter-process for ~0.3s of nothing.
*.[jJ][pP][gG] filter=annex
*.[jJ][pP][eE][gG] filter=annex
*.[pP][nN][gG] filter=annex
*.[wW][eE][bB][pP] filter=annex
*.[aA][vV][iI][fF] filter=annex
*.[hH][eE][iI][cC] filter=annex
*.[tT][iI][fF] filter=annex
*.[tT][iI][fF][fF] filter=annex
*.[gG][iI][fF] filter=annex
*.[wW][eE][bB][mM] filter=annex
*.[mM][pP]3 filter=annex
*.[mM]4[aA] filter=annex
*.[wW][aA][vV] filter=annex
*.[pP][dD][fF] filter=annex
*.[mM][pP]4 filter=annex
*.[mM][oO][vV] filter=annex
*.[fF][rR][oO][zZ][eE][nN] filter=annex
# A bulk batch holds arbitrary types and widens largefiles itself; the
# filter has to reach those paths for that to mean anything.
**/upload-*.attach/** filter=annex
**/*.upload-batch.attach/** filter=annex`);
});

// The character classes are deliberate. gitattributes globs are case-sensitive,
// and so is `annex.largefiles` (verified with git-annex 10.20260717: `include=*.jpg`
// does not match `UPPER.JPG`). Both renderings use the same classes, so a file
// cannot match one list and miss the other in either direction — a path largefiles
// annexes but the filter never sees is a raw blob, and a path the annex holds but
// the filter no longer covers reads back as `/annex/objects/…` text. Nothing a box
// commits as text appears in the list, the same property that makes the unscoped
// `annex.largefiles` safe.
//
// The batch lines are the only non-extension entries, and they are what make the
// batch-local `.gitattributes` (`* annex.largefiles=anything`, written by
// `core/bulk-upload/prepare.ts`) mean anything: largefiles is only consulted for a
// path the filter-process sees. Without this line a batch's `.zip` and
// extensionless files commit as raw blobs while its photos annex — verified at
// 1.5 MB each before it was added. The first line matches a batch's scope,
// `<slug>.attach`, named after its `upload-…` slug so the match follows the card
// when `bbx rm` or `bbx mv` moves it. The second covers scopes written before
// 2026-10 under the old fixed name, which survive in trash and rescued batches.
void test("The character classes are deliberate.", async (t) => {
  t.check(
    assetAnnexAttributes()
      .split("\n")
      .filter((line) => line.startsWith("**/")),
    [`${BULK_BATCH_ATTACH_PATTERN} filter=annex`, `${LEGACY_BULK_BATCH_ATTACH_PATTERN} filter=annex`],
  );

  t.check(BULK_BATCH_ATTACH_PATTERN, "**/upload-*.attach/**");
});

// Capture staging stays gitignored so pre-triage captures are never annexed. The
// pattern is unanchored because delivery targets `<contextDir>/tmp-capture/`, not
// only the box root — an anchored rule would miss real captures and annex them on
// arrival:
void test("Capture staging stays gitignored so pre-triage captures are never annexed.", async (t) => {
  t.check(CAPTURE_STAGING_IGNORE_PATTERN, "**/tmp-capture/**/*.attach/**");
});
