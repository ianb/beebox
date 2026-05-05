# Chat Session History

`chat-session-history.json` tracks which Claude session ids belong to web chat for this box, plus an optional per-session `contextDir` association used by landmark-started chats. The on-disk format evolved from a flat string array (v1) to per-session entries (v2); this doctest covers the migration and the directory-association helpers.

```ts setup
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadHistory,
  loadHistoryEntries,
  appendHistory,
  getDirectoryForSession,
  getLastSessionForDirectory,
} from "../src/core/chat-session-history.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Reading a v1 file

A legacy file with `sessionIds: [...]` reads back as entries with no `contextDir`. The migration is lazy — the file isn't rewritten until something appends.

```
const box = await makeTmpBox();
await box.write(
  ".callback-box/chat-session-history.json",
  JSON.stringify({ sessionIds: ["abc", "def"], migrated: true }),
);

JSON.stringify(await loadHistoryEntries(box.root), null, 2)
=>
[
  {
    "id": "abc"
  },
  {
    "id": "def"
  }
]

JSON.stringify(await loadHistory(box.root), null, 2)
=>
[
  "abc",
  "def"
]
```

```cleanup
await box.cleanup();
```

## Migrating on first write

Once `appendHistory` runs against a v1 file, it writes the new shape. v2 files round-trip unchanged.

```
const box = await makeTmpBox();
await box.write(
  ".callback-box/chat-session-history.json",
  JSON.stringify({ sessionIds: ["abc"], migrated: true }),
);

await appendHistory(box.root, { sessionId: "def" });

const raw = await readFile(join(box.root, ".callback-box/chat-session-history.json"), "utf-8");
const parsed = JSON.parse(raw);
JSON.stringify(parsed, null, 2)
=>
{
  "sessions": [
    {
      "id": "abc"
    },
    {
      "id": "def"
    }
  ],
  "migrated": true
}
```

```cleanup
await box.cleanup();
```

## appendHistory is idempotent on sessionId

A second call with the same id is a no-op.

```
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "abc" });
await appendHistory(box.root, { sessionId: "abc" });

(await loadHistory(box.root)).length
=> 1
```

```cleanup
await box.cleanup();
```

## appendHistory backfills a missing contextDir

When a session was first added without a `contextDir` (e.g. via the
registry's `onSessionIdAssigned` hook) and a later call supplies one,
the existing entry is updated rather than duplicated.

```
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "abc" });
await appendHistory(box.root, { sessionId: "abc", contextDir: "store/recipes" });

JSON.stringify(await loadHistoryEntries(box.root), null, 2)
=>
[
  {
    "id": "abc",
    "contextDir": "store/recipes"
  }
]
```

```cleanup
await box.cleanup();
```

## appendHistory does not clobber an existing contextDir

Once a session is bound to a directory, the binding is durable — a
later call with a different `contextDir` is ignored. Rebinding isn't
supported in v1.

```
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "abc", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "abc", contextDir: "store/todos" });

await getDirectoryForSession(box.root, "abc")
=> store/recipes
```

```cleanup
await box.cleanup();
```

## getDirectoryForSession returns null for unbound and unknown sessions

```
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "abc", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "def" });

await getDirectoryForSession(box.root, "abc")
=> store/recipes

await getDirectoryForSession(box.root, "def")
=> null

await getDirectoryForSession(box.root, "ghi")
=> null
```

```cleanup
await box.cleanup();
```

## getLastSessionForDirectory returns the most recently appended match

When several sessions are associated with the same directory, the
most-recent (last appended) wins. Sessions for other directories don't
interleave into the result.

```
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "first", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "other", contextDir: "store/todos" });
await appendHistory(box.root, { sessionId: "second", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "third", contextDir: "store/recipes" });

await getLastSessionForDirectory(box.root, "store/recipes")
=> third

await getLastSessionForDirectory(box.root, "store/todos")
=> other

await getLastSessionForDirectory(box.root, "store/never")
=> null
```

```cleanup
await box.cleanup();
```

## getLastSessionForDirectory ignores unbound sessions

Sessions in the history without a `contextDir` (e.g. plain web chats)
don't accidentally match any directory query.

```
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "plain" });
await appendHistory(box.root, { sessionId: "bound", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "another-plain" });

await getLastSessionForDirectory(box.root, "store/recipes")
=> bound
```

```cleanup
await box.cleanup();
```
