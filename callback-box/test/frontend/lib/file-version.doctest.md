# file-version cache-buster

Box files are served with `Cache-Control: no-cache` + an mtime ETag, so a fresh
request always revalidates. But when a file is overwritten while the chat is
open, the browser serves the already-loaded image from its in-memory cache to a
new `<img>` with the same URL — no network request, so the ETag never fires.
`file-version` stamps `?v=<token>` on the URLs of files that changed this
session (driven by `file-change` SSE events), forcing a fresh fetch.

```ts setup
import { bumpFileVersion, bustImageSrc } from "../../../src/frontend/src/lib/file-version.js";
```

## bustImageSrc

Files that haven't changed this session get no param — first loads stay clean and
cross-reload freshness keeps relying on the server ETag:

```ts
bustImageSrc("/main/test1/api/files/store/mara.webp")
=> /main/test1/api/files/store/mara.webp
```

Non-box URLs (no `/api/files/` segment) pass through untouched:

```ts
bustImageSrc("https://example.com/cat.png")
=> https://example.com/cat.png
```

Once a `file-change` is recorded for a path, its URL gets a `?v=<token>` so the
browser misses its in-memory cache and re-fetches:

```ts
bumpFileVersion("store/mara.webp", "1717270000000")

bustImageSrc("/main/test1/api/files/store/mara.webp")
=> /main/test1/api/files/store/mara.webp?v=1717270000000
```

Matching is by the box-relative path after `/api/files/`, so the same file is
busted regardless of the URL's base prefix (dev router worktree, prod root):

```ts
bustImageSrc("/wt-name/box/api/files/store/mara.webp")
=> /wt-name/box/api/files/store/mara.webp?v=1717270000000
```

A URL that already carries a query string gets the param appended with `&`:

```ts
bustImageSrc("/main/test1/api/files/store/mara.webp?raw=1")
=> /main/test1/api/files/store/mara.webp?raw=1&v=1717270000000
```

Other paths are unaffected — only the changed file is busted:

```ts
bustImageSrc("/main/test1/api/files/store/other.webp")
=> /main/test1/api/files/store/other.webp
```

A later change to the same path replaces the token (newest write wins):

```ts
bumpFileVersion("store/mara.webp", "1717280000000")

bustImageSrc("/main/test1/api/files/store/mara.webp")
=> /main/test1/api/files/store/mara.webp?v=1717280000000
```
