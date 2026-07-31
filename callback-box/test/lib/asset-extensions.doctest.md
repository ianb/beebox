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

The expression is an extension allowlist scoped to attach directories:

```ts
assetLargefilesExpression().startsWith("include=*.attach/*.jpg or include=*.attach/*.jpeg")
=> true

assetLargefilesExpression().includes("include=*.attach/*.frozen")
=> true
```

**It must not become a bare path glob.** A `.attach/` scope holds committed
non-assets alongside assets — capture writes child `.card` files into the
parent scope, `manifest.json` lives there, and email bodies land as `.txt`. On
one production box 1,844 tracked files sit inside `.attach/` scopes, so
`include=*.attach/*` would replace committed card text with annex pointers:

```ts
assetLargefilesExpression().includes("include=*.attach/*.card")
=> false

assetLargefilesExpression().includes("include=*.attach/*.json")
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
