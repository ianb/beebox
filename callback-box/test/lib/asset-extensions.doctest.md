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
  CAPTURE_STAGING_IGNORE_PATTERN,
} from "../../src/lib/asset-extensions.js";
```

Both renderers walk the same list, so an extension can never be ignored but
un-annexed (or the reverse) — the drift that let 41 MB `.frozen` pages into box
history came from exactly that kind of split:

```ts
assetGitignorePatterns().split("\n").length === ASSET_EXTENSIONS.length
=> true

assetLargefilesExpression().split(" or ").length === ASSET_EXTENSIONS.length * 2
=> true
```

The expression is an extension allowlist, **unscoped** — it matches a binary
anywhere, not only inside `.attach/`. That is deliberate: git-annex replaces Git
LFS, which was itself unscoped, and anchoring to `.attach/` would strand LFS's
content (legacy captures under `box/inbox/`) with no mechanism at all.

```ts
assetLargefilesExpression().startsWith("include=*.jpg or include=*.JPG or include=*.jpeg")
=> true

assetLargefilesExpression().includes("include=*.frozen")
=> true

assetLargefilesExpression().includes(".attach/")
=> false
```

git-annex's globs are case-sensitive, while cameras commonly produce
all-uppercase extensions. Each asset extension therefore gets its lowercase
and uppercase spelling. Mixed case is deliberately left to the wider
attributes filter below rather than multiplying the largefiles expression:

```ts
ASSET_EXTENSIONS.every((ext) => assetLargefilesExpression().includes(`include=*.${ext}`))
=> true

ASSET_EXTENSIONS.every((ext) => assetLargefilesExpression().includes(`include=*.${ext.toUpperCase()}`))
=> true

assetLargefilesExpression().includes("include=*.HeIc")
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
```

Every extension gets a line, and the marker names the owner so drift from
git-annex's own file is visible without a diff:

```ts
assetAnnexAttributes().split("\n").filter((l) => l.endsWith("filter=annex")).length === ASSET_EXTENSIONS.length
=> true

assetAnnexAttributes().startsWith(ANNEX_ATTRIBUTES_MARKER)
=> true

assetAnnexAttributes().includes("\n* filter=annex")
=> false
```

The character classes are deliberate. gitattributes globs are case-sensitive,
and so is `annex.largefiles` (verified with git-annex 10.20260717: `include=*.jpg`
does not match `UPPER.JPG`). Largefiles explicitly covers lowercase and
uppercase; attributes additionally cover mixed case. That wider list is the
safe side of an asymmetry — an over-wide attribute line runs a filter that then
declines to annex, while a missing one strands a pointer and the file reads back
as `/annex/objects/…` text:

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
