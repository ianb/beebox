# History diff parser: LFS and git-annex pointers render as binary, not text

An annexed (or LFS-tracked) file's blob is a ~100-byte text pointer, so a diff
adding or removing one looks like an ordinary text change. Without detection the
history view renders the pointer string (`/annex/objects/SHA256E-…`) where the
image should be. `parseDiff` marks these files `binary`, which routes them to
the blob-preview path instead of the text renderer.

```ts setup
import { parseDiff } from "../../src/frontend/src/components/history/CommitDetail-diff.js";

const ANNEX_KEY =
  "SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg";

function diffFor(path: string, marker: string, line: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    marker,
    `index 0000000..1111111`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    line,
  ].join("\n");
}

function summarize(diff: string): string {
  const files = parseDiff(diff);
  return files
    .map((f) => `${f.path} binary=${f.binary} hunks=${f.hunks.length}`)
    .join("\n");
}
```

An **added** annexed file — its pointer arrives on a `+` line:

```ts
summarize(diffFor("photos/cat.jpg", "new file mode 120000", `+/annex/objects/${ANNEX_KEY}`))
=> photos/cat.jpg binary=true hunks=0
```

A **removed** annexed file — the pointer shows up on a `-` line. (This was the
reported bug's second half: removed annexed images rendered as pointer text.)

```ts continue
summarize(diffFor("photos/cat.jpg", "deleted file mode 120000", `-/annex/objects/${ANNEX_KEY}`))
=> photos/cat.jpg binary=true hunks=0
```

A **removed LFS** file gets the same treatment — the old check only looked at
added lines:

```ts continue
summarize(diffFor("clip.mp4", "deleted file mode 100644", "-version https://git-lfs.github.com/spec/v1"))
=> clip.mp4 binary=true hunks=0
```

Ordinary text that merely *mentions* the annex path mid-line is untouched — the
prefix must start the changed line:

```ts continue
summarize(diffFor("notes.md", "new file mode 100644", "+see /annex/objects/ for storage details"))
=> notes.md binary=false hunks=2
```
