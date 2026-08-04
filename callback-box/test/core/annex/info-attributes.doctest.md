# `.git/info/attributes` — the annex filter's scope on disk

git-annex claims the whole repository (`* filter=annex`); we narrow it to the
asset extensions so a text-only commit never starts the filter-process. See
`src/core/annex/info-attributes.ts`.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  annexInfoAttributesPath,
  readAnnexInfoAttributes,
  uncoveredAnnexedPaths,
  writeAnnexInfoAttributes,
} from "../../../src/core/annex/info-attributes.js";
import { assetAnnexAttributes } from "../../../src/lib/asset-extensions.js";
```

The file is absent until something writes it, and an absent file reads as
`null` rather than throwing — a repository that has never run `git annex init`
is a normal state, not an error:

```ts
const box = await makeTmpBox();
await readAnnexInfoAttributes(box.packageRoot)
=> null

annexInfoAttributesPath(box.packageRoot).endsWith("/.git/info/attributes")
=> true
```

Writing replaces whatever was there — git-annex owns this path and writes a
fixed one-line file, so there is no hand-authored content to merge with, and a
merge would have to guess which of two conflicting `filter=annex` claims wins:

```ts continue
const fs = await import("node:fs/promises");
const path = await import("node:path");
await fs.mkdir(path.dirname(annexInfoAttributesPath(box.packageRoot)), { recursive: true });
await fs.writeFile(annexInfoAttributesPath(box.packageRoot), "\n* filter=annex\n");
await writeAnnexInfoAttributes(box.packageRoot);
await readAnnexInfoAttributes(box.packageRoot) === assetAnnexAttributes()
=> true
```

Idempotent, because `cb init` runs the repair on every invocation:

```ts continue
await writeAnnexInfoAttributes(box.packageRoot);
await readAnnexInfoAttributes(box.packageRoot) === assetAnnexAttributes()
=> true
```

```ts cleanup
await box.cleanup();
```

## The coverage check that makes scoping safe

Narrowing the filter is only safe while every already-annexed path has an
extension on the list. One that does not keeps its pointer in git but loses the
smudge filter, so the next checkout writes `/annex/objects/…` text where the
bytes were. `uncoveredAnnexedPaths` is what turns that into a loud error
instead of silent breakage:

```ts
uncoveredAnnexedPaths(["a.attach/photo.jpg", "a.attach/clip.mov", "a.attach/page.frozen"])
=> []

uncoveredAnnexedPaths(["a.attach/photo.jpg", "a.attach/scan.psd", "a.attach/notes"])
=> [
  "a.attach/scan.psd",
  "a.attach/notes"
]
```

Case-insensitive, matching the character classes the rendered lines use — an
iOS `.HEIC` is covered even though `annex.largefiles`' `include=*.heic` would
not match it:

```ts
uncoveredAnnexedPaths(["a.attach/IMG_0001.HEIC", "a.attach/CLIP.MOV"])
=> []
```
