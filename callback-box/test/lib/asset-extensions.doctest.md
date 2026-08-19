# Asset classifier — `annex.largefiles`

`ASSET_EXTENSIONS` is the single source of truth for what counts as
an asset. It renders into `.gitignore` patterns today and, under git-annex,
into an `annex.largefiles` expression deciding what `git add` routes into the
annex. See `src/lib/asset-extensions.ts`.

```ts setup
import {
  ANNEX_ATTRIBUTES_MARKER,
  ASSET_EXTENSIONS,
  assetAnnexAttributes,
  assetGitignorePatterns,
  assetLargefilesExpression,
  BULK_BATCH_ATTACH_PATTERN,
  CAPTURE_STAGING_IGNORE_PATTERN,
} from "../../src/lib/asset-extensions.js";
```

Both renderers walk the same list, so an extension can never be ignored but
un-annexed (or the reverse) — the drift that let 41 MB `.frozen` pages into box
history came from exactly that kind of split:

```ts
assetGitignorePatterns().split("\n").length === ASSET_EXTENSIONS.length
=> true

assetLargefilesExpression().split(" or ").length === ASSET_EXTENSIONS.length
=> true
```

The expression is an extension allowlist, **unscoped** — it matches a binary
anywhere, not only inside `.attach/`. That is deliberate: git-annex replaces Git
LFS, which was itself unscoped, and anchoring to `.attach/` would strand LFS's
content (legacy captures under `box/inbox/`) with no mechanism at all.

```ts
assetLargefilesExpression().startsWith("include=*.[jJ][pP][gG] or include=*.[jJ][pP][eE][gG]")
=> true

assetLargefilesExpression().includes("include=*.[fF][rR][oO][zZ][eE][nN]")
=> true

assetLargefilesExpression().includes(".attach/")
=> false
```

git-annex's globs are case-sensitive, and cameras produce all-uppercase
extensions while file managers and scanner apps produce mixed ones. Every
extension therefore renders through the same per-character any-case glob the
attributes file uses, so the two lists match exactly the same paths.

An earlier version emitted only the lowercase and all-uppercase spellings and
left mixed case to the wider attributes filter, on the reasoning that an
over-wide attribute line is harmless. It is not: the filter runs, finds no
largefiles match, and the bytes commit as a raw git blob. Verified 2026-08-18 on
a real annex box — `Mixed.Jpg` landed as a 1.5 MB blob beside 102-byte pointers
for `lower.jpg` and `upper.JPG`.

```ts
assetLargefilesExpression().includes("include=*.[hH][eE][iI][cC]")
=> true

["include=*.heic", "include=*.HEIC"].some((s) => assetLargefilesExpression().includes(s))
=> false
```

**It must not become a bare path glob.** A `.attach/` scope holds committed
non-assets alongside assets — capture writes child `.card` files into the
parent scope, `manifest.json` lives there, and email bodies land as `.txt`. On
one production box 1,844 tracked files sit inside `.attach/` scopes, so
`include=*.attach/*` would replace committed card text with annex pointers:

Unscoped is safe precisely because it is an *extension* allowlist: cards,
manifests, and email bodies never match, wherever they live.

```ts
["card", "json", "md", "txt"].some((e) => assetLargefilesExpression().includes(`include=*.${e}`))
=> false

assetLargefilesExpression() === "include=*.attach/*"
=> false
```

## `.git/info/attributes` — which paths reach the annex filter

The third rendering: what git hands to the git-annex filter-process. git-annex
itself writes `* filter=annex` there, so a commit of two text cards pays ~0.3s
of filter startup for nothing. Since `annex.largefiles` is purely
extension-based, the filter is scoped to the same extensions:

```ts
assetAnnexAttributes()
=> # Managed by callback-box — do not edit.
# Rendered from ASSET_EXTENSIONS (src/lib/asset-extensions.ts); `cb doctor annex` restores it.
# Replaces git-annex's default `* filter=annex`, which puts every text commit
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
**/*.upload-batch.attach/** filter=annex
```

Every extension gets a line, plus the one path line, and the marker names the
owner so drift from git-annex's own file is visible without a diff:

```ts
assetAnnexAttributes().split("\n").filter((l) => l.endsWith("filter=annex")).length === ASSET_EXTENSIONS.length + 1
=> true

assetAnnexAttributes().startsWith(ANNEX_ATTRIBUTES_MARKER)
=> true

assetAnnexAttributes().includes("\n* filter=annex")
=> false
```

The character classes are deliberate. gitattributes globs are case-sensitive,
and so is `annex.largefiles` (verified with git-annex 10.20260717: `include=*.jpg`
does not match `UPPER.JPG`). Both renderings use the same classes, so a file
cannot match one list and miss the other in either direction — a path largefiles
annexes but the filter never sees is a raw blob, and a path the annex holds but
the filter no longer covers reads back as `/annex/objects/…` text:

```ts
assetAnnexAttributes().includes("*.[hH][eE][iI][cC] filter=annex")
=> true

assetAnnexAttributes().includes("*.heic filter=annex")
=> false
```

Nothing a box commits as text may appear here — the same property that makes
the unscoped `annex.largefiles` safe:

```ts
["card", "json", "md", "txt"].some((e) => assetAnnexAttributes().includes(`*.${e}`))
=> false
```

The batch line is the only non-extension entry, and it is what makes the
batch-local `.gitattributes` (`* annex.largefiles=anything`, written by
`core/bulk-upload/prepare.ts`) mean anything: largefiles is only consulted for a
path the filter-process sees. Without this line a batch's `.zip` and
extensionless files commit as raw blobs while its photos annex — verified at
1.5 MB each before it was added.

```ts
assetAnnexAttributes().includes(`${BULK_BATCH_ATTACH_PATTERN} filter=annex`)
=> true

BULK_BATCH_ATTACH_PATTERN.startsWith("**/")
=> true
```

Capture staging stays gitignored so pre-triage captures are never annexed. The
pattern is unanchored because delivery targets `<contextDir>/tmp-capture/`, not
only the box root — an anchored rule would miss real captures and annex them on
arrival:

```ts
CAPTURE_STAGING_IGNORE_PATTERN.startsWith("**/")
=> true

CAPTURE_STAGING_IGNORE_PATTERN.startsWith("content/")
=> false
```
