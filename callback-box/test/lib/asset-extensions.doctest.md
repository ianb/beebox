# Asset classifier — `annex.largefiles`

`ASSET_EXTENSIONS` is the single source of truth for what counts as
an asset. It renders into `.gitignore` patterns today and, under git-annex,
into an `annex.largefiles` expression deciding what `git add` routes into the
annex. See `src/lib/asset-extensions.ts`.

```ts setup
import {
  ASSET_EXTENSIONS,
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

assetLargefilesExpression().split(" or ").length === ASSET_EXTENSIONS.length
=> true
```

The expression is an extension allowlist, **unscoped** — it matches a binary
anywhere, not only inside `.attach/`. That is deliberate: git-annex replaces Git
LFS, which was itself unscoped, and anchoring to `.attach/` would strand LFS's
content (legacy captures under `box/inbox/`) with no mechanism at all.

```ts
assetLargefilesExpression().startsWith("include=*.jpg or include=*.jpeg")
=> true

assetLargefilesExpression().includes("include=*.frozen")
=> true

assetLargefilesExpression().includes(".attach/")
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
