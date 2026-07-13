# Multi-root session discovery

A landmark-bound chat runs the SDK with `cwd = <boxRoot>/<contextDir>`,
so its transcript lives under a *different* encoded directory in
`~/.claude/projects/` than root-bound chats. Discovery therefore spans
"context roots": the box root plus one root per distinct `contextDir`
in `chat-session-history.json`. `listSessionRoots` enumerates them,
`listSessions` aggregates transcripts across all of them, and
`findSessionLog` resolves a single id (reporting every directory it
searched on a miss). Transcript location honors `CB_CLAUDE_PROJECTS_DIR`.

```ts setup
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { findSessionLog, listSessions } from "../../../src/cli/lib/session.js";
import { listSessionRoots } from "../../../src/core/chat/session/history.js";
import {
  encodeProjectDir,
  getSessionLogPath,
} from "../../../src/core/chat/session/transcript-paths.js";

// Seed a transcript at the encoded location for `cwd`, with a fixed
// mtime so ordering assertions are deterministic.
async function seedLog(cwd: string, opts: { id: string; mtime: string }): Promise<void> {
  const logPath = getSessionLogPath(cwd, opts.id);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "{}\n");
  const t = new Date(opts.mtime);
  await utimes(logPath, t, t);
}
```

## listSessionRoots — box root first, deduped, existence-filtered

The history file below has: a root-bound session, two sessions in the
same landmark dir (the root must appear only once), and a "ghost"
landmark whose encoded dir never got a transcript (filtered out). The
box-root entry is always returned, even before any transcript exists.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("projects");
const rootSession = "aaaa1111-0000-0000-0000-000000000001";
const bunkerOld = "bbbb2222-0000-0000-0000-000000000002";
const bunkerNew = "cccc3333-0000-0000-0000-000000000003";
await box.write(".callback-box/chat-session-history.json", JSON.stringify({
  sessions: [
    { id: rootSession, contextDir: "" },
    { id: bunkerOld, contextDir: "store/bunker" },
    { id: bunkerNew, contextDir: "store/bunker" },
    { id: "dddd4444-0000-0000-0000-000000000004", contextDir: "store/gone" },
  ],
  migrated: true,
}));
await seedLog(box.root, { id: rootSession, mtime: "2026-07-02T10:00:00Z" });
await seedLog(join(box.root, "store/bunker"), { id: bunkerOld, mtime: "2026-07-01T10:00:00Z" });
await seedLog(join(box.root, "store/bunker"), { id: bunkerNew, mtime: "2026-07-03T10:00:00Z" });

// Encoded dir names start with the encoded (random) tmp package root —
// strip that prefix so expected output stays deterministic.
const prefix = encodeProjectDir(box.packageRoot);
const roots = await listSessionRoots(box.root);
JSON.stringify(roots.map((r) => ({
  contextDir: r.contextDir,
  dir: basename(r.dir).slice(prefix.length),
})), null, 2)
=>
[
  {
    "contextDir": "",
    "dir": "-content"
  },
  {
    "contextDir": "store/bunker",
    "dir": "-content-store-bunker"
  }
]
```

## listSessions — aggregated across roots, newest first, contextDir tagged

```ts continue
const sessions = await listSessions(box.root);
JSON.stringify(sessions.map((s) => ({
  id: s.sessionId.slice(0, 8),
  contextDir: s.contextDir,
})), null, 2)
=>
[
  {
    "id": "cccc3333",
    "contextDir": "store/bunker"
  },
  {
    "id": "aaaa1111",
    "contextDir": ""
  },
  {
    "id": "bbbb2222",
    "contextDir": "store/bunker"
  }
]
```

## findSessionLog — a landmark session resolves via history

```ts continue
const found = await findSessionLog(box.root, bunkerNew);
found.ok
=> true

found.ok && found.value === getSessionLogPath(join(box.root, "store/bunker"), bunkerNew)
=> true
```

A session missing from the history file is still found by probing every
root (the transcript exists; only the history entry is absent):

```ts continue
const orphan = "eeee5555-0000-0000-0000-000000000005";
await seedLog(join(box.root, "store/bunker"), { id: orphan, mtime: "2026-07-04T10:00:00Z" });
const foundOrphan = await findSessionLog(box.root, orphan);
foundOrphan.ok && foundOrphan.value === getSessionLogPath(join(box.root, "store/bunker"), orphan)
=> true
```

## findSessionLog miss — the error carries EVERY directory searched

The command prints these one per line, so a user (or agent) sees the
full sweep rather than a single misleading path.

```ts continue
const missing = await findSessionLog(box.root, "ffff6666-0000-0000-0000-000000000006");
missing.ok
=> false

!missing.ok && JSON.stringify(missing.error.map((d) => basename(d).slice(prefix.length)), null, 2)
=>
[
  "-content",
  "-content-store-bunker"
]
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
