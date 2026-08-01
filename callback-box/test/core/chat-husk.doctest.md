# Chat husks — a `chat` card per web chat session

`ensureChatHusk` creates the session's card under `store/chat/web/`
(docs/plans/chat-husks.md): identity + editorial only, with the
`_<shortid>.chat.card` filename suffix as the idempotency key.
`reconcileChatHusks` gives every history entry a husk, skipping ghosts
whose transcript is gone.

```ts setup
import { mkdir, writeFile, readFile as readFsFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { ensureChatHusk, findChatHusk, reconcileChatHusks, listChatHusks } from "../../src/core/chat/husk.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";
```

## ensure creates the husk, named by date + short session id

The `session` field carries the association; there is no activity state
on the card. A brand-new session has no readable transcript yet, so the
husk starts untitled.

```ts
const box = await makeTmpBox();
const path = await ensureChatHusk(box.root, {
  sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
  contextDir: "store/projects",
  date: new Date("2026-07-02T12:00:00Z"),
});
path
=> store/chat/web/2026-07-02_59fc20dd.chat.card

await box.read(path)
=> ---
session: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869
context-dir: store/projects
---
```

## ensure is idempotent — a later call finds the existing husk by suffix

Even with a different date: the suffix, not the full name, is the key.

```ts continue
await ensureChatHusk(box.root, {
  sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
  date: new Date("2026-08-01T12:00:00Z"),
})
=> store/chat/web/2026-07-02_59fc20dd.chat.card

await findChatHusk(box.root, "59fc20dd-fe6d-45cb-8f37-f1508a5a0869")
=> store/chat/web/2026-07-02_59fc20dd.chat.card

await findChatHusk(box.root, "00000000-unknown")
=> null
```

## reconcile husks every history entry, skipping ghosts

Transcript discovery honors `CB_CLAUDE_PROJECTS_DIR`; a history entry
whose JSONL is gone (a "ghost") gets no husk.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("projects");
const live = "aaaa1111-2222-3333-4444-555566667777";
const ghost = "bbbb1111-2222-3333-4444-555566667777";
await box.write(".callback-box/chat-session-history.json", JSON.stringify({
  sessions: [{ id: live, contextDir: "" }, { id: ghost }],
  migrated: true,
}));
const logPath = getSessionLogPath(box.root, live);
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, "{}\n");

await reconcileChatHusks(box.root);
const huskPath = await findChatHusk(box.root, live);
huskPath !== null
=> true

await findChatHusk(box.root, ghost)
=> null

(await readFsFile(box.path(huskPath ?? ""), "utf-8")).includes(`session: ${live}`)
=> true
```

It re-runs on every boot rather than once behind a marker, so a session
that never got its husk — the assignment-time write is best-effort, and the
history backfill may still have been writing entries during an earlier pass —
is repaired by the next one instead of staying invisible forever.

```ts continue
const late = "cccc1111-2222-3333-4444-555566667777";
const lateLog = getSessionLogPath(box.root, late);
await mkdir(dirname(lateLog), { recursive: true });
await writeFile(lateLog, "{}\n");
await box.write(".callback-box/chat-session-history.json", JSON.stringify({
  sessions: [{ id: live }, { id: late }],
  migrated: true,
}));

await reconcileChatHusks(box.root);
(await findChatHusk(box.root, late)) !== null
=> true
```

An already-husked session is left exactly as it was — no duplicate card.

```ts continue
const before = await listChatHusks(box.root);
await reconcileChatHusks(box.root);
const again = await listChatHusks(box.root);
`${before.length} then ${again.length}`
=> 2 then 2
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
```

## listChatHusks enumerates the cards — they ARE the session list

The picker reads husks, not the history file: a `title` on the card wins
over any transcript snippet, and a deleted husk means the session is
editorially gone from the picker. Files without a `session` field are
skipped.

```ts
const box = await makeTmpBox();
await ensureChatHusk(box.root, {
  sessionId: "aaaa1111-0000-0000-0000-000000000000",
  contextDir: "store/projects",
  date: new Date("2026-07-01T12:00:00Z"),
});
await box.write("store/chat/web/renamed-topic_bbbb2222.chat.card", `---
session: bbbb2222-0000-0000-0000-000000000000
title: Planning the garden
---
`);
await box.write("store/chat/web/broken.chat.card", "no frontmatter here\n");
const husks = await listChatHusks(box.root);
JSON.stringify(husks.map((h) => ({ session: h.session.slice(0, 8), title: h.title ?? null, contextDir: h.contextDir ?? null })), null, 2)
=>
[
  {
    "session": "aaaa1111",
    "title": null,
    "contextDir": "store/projects"
  },
  {
    "session": "bbbb2222",
    "title": "Planning the garden",
    "contextDir": null
  }
]
```
