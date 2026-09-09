# Authored-view watcher paths

`viewSlugFromSourcePath` recognizes both supported box layouts. This parser is
shared by view-binding invalidation and active-module reload so package boxes
cannot silently miss either half of live updating.

```ts setup
import { viewSlugFromSourcePath } from "../../../src/frontend/src/lib/view-source-path.js";
```

Legacy and package-layout paths resolve to the same slug:

```ts
viewSlugFromSourcePath("views/catalog.tsx")
=> catalog

viewSlugFromSourcePath("src/views/catalog.tsx")
=> catalog
```

Files outside the direct authored-view directories are ignored:

```ts
viewSlugFromSourcePath("src/views/helpers/catalog.tsx")
=> null

viewSlugFromSourcePath("content/views/catalog.tsx")
=> null

viewSlugFromSourcePath("src/views/catalog.ts")
=> null
```
