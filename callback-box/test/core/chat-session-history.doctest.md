# Chat Session History

`chat-session-history.json` tracks which Claude session ids belong to web chat for this box, plus an optional per-session `contextDir` association used by landmark-started chats. The on-disk format evolved from a flat string array (v1) to per-session entries (v2); this doctest covers the migration and the directory-association helpers.

```ts setup
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  loadHistory,
  loadHistoryEntries,
  appendHistory,
  getDirectoryForSession,
  getLastSessionForDirectory,
  resolveSessionLogPath,
} from "../../src/core/chat-session-history.js";
import { getSessionDir } from "../../src/cli/lib/session.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// `getLastSessionForDirectory` skips entries whose JSONL doesn't exist
// on disk (the "ghost" check guards against resuming sessions the SDK
// never wrote). Tests that exercise that helper need to seed empty
// JSONLs at the resolved path, plus clean up the ~/.claude/projects
// directories that creates.
async function seedSessionLog(boxRoot: string, sessionId: string): Promise<void> {
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "");
}

async function cleanupSessionLogs(boxRoot: string, contextDirs: string[]): Promise<void> {
  const dirs = new Set<string>([getSessionDir(boxRoot)]);
  for (const d of contextDirs) {
    if (d) dirs.add(getSessionDir(join(boxRoot, d)));
  }
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
}
```

## Reading a v1 file

A legacy file with `sessionIds: [...]` reads back as entries with no `contextDir`. The migration is lazy — the file isn't rewritten until something appends.

```ts
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

```ts cleanup
await box.cleanup();
```

## Migrating on first write

Once `appendHistory` runs against a v1 file, it writes the new shape. v2 files round-trip unchanged.

```ts
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

```ts cleanup
await box.cleanup();
```

## appendHistory is idempotent on sessionId

A second call with the same id is a no-op.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "abc" });
await appendHistory(box.root, { sessionId: "abc" });

(await loadHistory(box.root)).length
=> 1
```

```ts cleanup
await box.cleanup();
```

## appendHistory backfills a missing contextDir

When a session was first added without a `contextDir` (e.g. via the
registry's `onSessionIdAssigned` hook) and a later call supplies one,
the existing entry is updated rather than duplicated.

```ts
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

```ts cleanup
await box.cleanup();
```

## appendHistory does not clobber an existing contextDir

Once a session is bound to a directory, the binding is durable — a
later call with a different `contextDir` is ignored. Rebinding isn't
supported in v1.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "abc", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "abc", contextDir: "store/todos" });

await getDirectoryForSession(box.root, "abc")
=> store/recipes
```

```ts cleanup
await box.cleanup();
```

## getDirectoryForSession returns null for unbound and unknown sessions

```ts
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

```ts cleanup
await box.cleanup();
```

## getLastSessionForDirectory returns the most recently appended match

When several sessions are associated with the same directory, the
most-recent (last appended) wins. Sessions for other directories don't
interleave into the result.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "first", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "other", contextDir: "store/todos" });
await appendHistory(box.root, { sessionId: "second", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "third", contextDir: "store/recipes" });
await seedSessionLog(box.root, "first");
await seedSessionLog(box.root, "other");
await seedSessionLog(box.root, "second");
await seedSessionLog(box.root, "third");

await getLastSessionForDirectory(box.root, "store/recipes")
=> third

await getLastSessionForDirectory(box.root, "store/todos")
=> other

await getLastSessionForDirectory(box.root, "store/never")
=> null
```

```ts cleanup
await cleanupSessionLogs(box.root, ["store/recipes", "store/todos"]);
await box.cleanup();
```

## getLastSessionForDirectory ignores unbound sessions

Sessions in the history without a `contextDir` (e.g. plain web chats)
don't accidentally match any directory query.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "plain" });
await appendHistory(box.root, { sessionId: "bound", contextDir: "store/recipes" });
await appendHistory(box.root, { sessionId: "another-plain" });
await seedSessionLog(box.root, "plain");
await seedSessionLog(box.root, "bound");
await seedSessionLog(box.root, "another-plain");

await getLastSessionForDirectory(box.root, "store/recipes")
=> bound
```

```ts cleanup
await cleanupSessionLogs(box.root, ["store/recipes"]);
await box.cleanup();
```
