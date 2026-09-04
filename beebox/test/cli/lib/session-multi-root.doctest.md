# Multi-root session discovery

A landmark-bound chat runs the SDK with `cwd = <boxRoot>/<contextDir>`,
so its transcript lives under a *different* encoded directory in
`~/.claude/projects/` than root-bound chats. Discovery therefore spans
"context roots": the box root plus one root per distinct `contextDir`
in `chat-session-history.json`. `listSessionRoots` enumerates them,
`listSessions` aggregates transcripts across all of them, and
`findSessionLog` resolves a single id (reporting every directory it
searched on a miss). Transcript location honors `BBX_CLAUDE_PROJECTS_DIR`.

```ts setup
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { findSessionLog, listSessions } from "../../../src/cli/lib/session.js";
import { partitionByAffinity } from "../../../src/cli/commands/session-modes.js";
import {
  listSessionRoots,
  loadHistoryEntries,
} from "../../../src/core/chat/session/history.js";
import { runBackfillIfNeeded } from "../../../src/core/chat/session/backfill.js";
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
same landmark dir (the root must appear only once), a "ghost" landmark
whose encoded dir never got a transcript (filtered out), and a row whose
`contextDir` climbs out of the box. That last row has a transcript seeded
where the uncontained join would land, and it is still not listed: the
row is contained to the box root, which is already present. The box-root
entry is always returned, even before any transcript exists.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");
const rootSession = "aaaa1111-0000-0000-0000-000000000001";
const bunkerOld = "bbbb2222-0000-0000-0000-000000000002";
const bunkerNew = "cccc3333-0000-0000-0000-000000000003";
const escaped = "eeee5555-0000-0000-0000-000000000005";
await box.write(".beebox/chat-session-history.json", JSON.stringify({
  sessions: [
    { id: rootSession, contextDir: "" },
    { id: bunkerOld, contextDir: "store/bunker" },
    { id: bunkerNew, contextDir: "store/bunker" },
    { id: "dddd4444-0000-0000-0000-000000000004", contextDir: "store/gone" },
    { id: escaped, contextDir: "../../elsewhere" },
  ],
  migrated: true,
}));
await seedLog(box.root, { id: rootSession, mtime: "2026-07-02T10:00:00Z" });
await seedLog(join(box.root, "../../elsewhere"), { id: escaped, mtime: "2026-07-04T10:00:00Z" });
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
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```

## Collision labeling — bindings beat the root a file was found under

The projects-dir encoding is lossy: `store/a-b` and `store/a_b` collapse
to the same encoded directory. Root-level dedupe keeps only one root for
that dir, so labels must come from each session's own history binding —
otherwise every file in the shared dir would inherit the first root's
contextDir.

```ts
const box2 = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box2.path("projects");
const dashId = "1111aaaa-0000-0000-0000-000000000001";
const underId = "2222bbbb-0000-0000-0000-000000000002";
await box2.write(".beebox/chat-session-history.json", JSON.stringify({
  sessions: [
    { id: dashId, contextDir: "store/a-b" },
    { id: underId, contextDir: "store/a_b" },
  ],
  migrated: true,
}));

// The two contextDirs really do encode to the same projects dir.
getSessionLogPath(join(box2.root, "store/a-b"), "x")
  === getSessionLogPath(join(box2.root, "store/a_b"), "x")
=> true

await seedLog(join(box2.root, "store/a-b"), { id: dashId, mtime: "2026-07-01T10:00:00Z" });
await seedLog(join(box2.root, "store/a_b"), { id: underId, mtime: "2026-07-02T10:00:00Z" });
const collided = await listSessions(box2.root);
JSON.stringify(collided.map((s) => ({
  id: s.sessionId.slice(0, 4),
  contextDir: s.contextDir,
})), null, 2)
=>
[
  {
    "id": "2222",
    "contextDir": "store/a_b"
  },
  {
    "id": "1111",
    "contextDir": "store/a-b"
  }
]
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box2.cleanup();
```

## Backfill keeps the landmark binding it discovers

A landmark transcript found by the backfill scan is appended WITH its
root's contextDir (a bare id would make `resolveSessionLogPath` treat it
as root-bound). Box-root finds stay bare-id, matching pre-landmark
entries. Note the scan only reaches landmark dirs that some existing
history entry already names.

```ts
const box3 = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box3.path("projects");
const knownId = "aaaa0000-0000-0000-0000-000000000001";
const foundLandmark = "bbbb0000-0000-0000-0000-000000000002";
const foundRoot = "cccc0000-0000-0000-0000-000000000003";
await box3.write(".beebox/chat-session-history.json", JSON.stringify({
  sessions: [{ id: knownId, contextDir: "store/bunker" }],
  migrated: false,
}));
const chatLine = JSON.stringify({
  type: "user",
  message: { role: "user", content: [{ type: "text", text: "<typed>hi</typed>" }] },
}) + "\n";
const rootLog = getSessionLogPath(box3.root, foundRoot);
await mkdir(dirname(rootLog), { recursive: true });
await writeFile(rootLog, chatLine);
const landmarkLog = getSessionLogPath(join(box3.root, "store/bunker"), foundLandmark);
await mkdir(dirname(landmarkLog), { recursive: true });
await writeFile(landmarkLog, chatLine);

await runBackfillIfNeeded(box3.root);
JSON.stringify(await loadHistoryEntries(box3.root), null, 2)
=>
[
  {
    "id": "aaaa0000-0000-0000-0000-000000000001",
    "engine": "claude",
    "contextDir": "store/bunker"
  },
  {
    "id": "cccc0000-0000-0000-0000-000000000003",
    "engine": "claude"
  },
  {
    "id": "bbbb0000-0000-0000-0000-000000000002",
    "engine": "claude",
    "contextDir": "store/bunker"
  }
]
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box3.cleanup();
```

## Affinity partition — ancestors are peers, deepest first, cap-safe

`partitionByAffinity` implements `bbx session`'s cwd affinity: a session
is a peer when bound to the cwd's dir itself OR an enclosing dir. Peers
come back deepest binding first (exact dir before ancestors), keeping
the input's newest-first order within a depth; root-bound sessions are
never peers of a subdirectory.

```ts
const mk = (id, contextDir) => ({ id, contextDir });
const input = [
  mk("root-new", ""),
  mk("anc", "store"),
  mk("other", "store/other"),
  mk("exact-new", "store/bunker"),
  mk("exact-old", "store/bunker"),
];
const { peers, others } = partitionByAffinity(input, "store/bunker");
peers.map((s) => s.id).join(", ")
=> exact-new, exact-old, anc

others.map((s) => s.id).join(", ")
=> root-new, other
```

The list mode partitions BEFORE its 20-item cap, so a peer older than
the cap still lists first — modeled here with a cap of 3:

```ts continue
const many = [mk("a", ""), mk("b", ""), mk("c", ""), mk("old-peer", "store/bunker")];
const p2 = partitionByAffinity(many, "store/bunker");
[...p2.peers, ...p2.others].slice(0, 3).map((s) => s.id).join(", ")
=> old-peer, a, b
```
