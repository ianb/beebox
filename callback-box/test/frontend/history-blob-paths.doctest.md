# History blob paths preserve Git filenames through URLs

Git quotes paths containing non-ASCII bytes with C-style octal escapes. The
history diff parser decodes those bytes before displaying or fetching the file.

```ts setup
import { parseDiff } from "../../src/frontend/src/components/history/CommitDetail-diff.js";
import { buildHistoryBlobUrl } from "../../src/frontend/src/components/history/history-blob-url.js";
```

A quoted UTF-8 filename is decoded in both the diff header and rename metadata:

```ts
const quotedRename = [
  'diff --git "a/old/caf\\303\\251 #100%.png" "b/new/caf\\303\\251 #100%.png"',
  "similarity index 100%",
  'rename from "old/caf\\303\\251 #100%.png"',
  'rename to "new/caf\\303\\251 #100%.png"',
].join("\n");
const renamed = parseDiff(quotedRename)[0];
JSON.stringify({ path: renamed?.path, move: renamed?.move })
=> {"path":"new/café #100%.png","move":{"basename":"café #100%.png","fromDir":"old/","toDir":"new/"}}
```

Characters with URL meaning are encoded within each segment while directory
separators remain separators:

```ts
const specialPath = parseDiff(
  "diff --git a/media/100%#?.png b/media/100%#?.png\nBinary files differ"
)[0]?.path;
buildHistoryBlobUrl({ apiBase: "/api", hash: "abc123", filePath: specialPath ?? "" })
=> /api/history/blob/abc123/media/100%25%23%3F.png
```
