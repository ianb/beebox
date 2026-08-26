# Chat husks — a `chat` card per web chat session

`ensureChatHusk` creates the session's card under `store/chat/web/`
(docs/plans/chat-husks.md): identity + editorial only, keyed on the
`session` field — the `_<shortid>.chat.card` filename is a naming
convention and a lookup hint, nothing more.
`reconcileChatHusks` gives every history entry a husk, skipping ghosts
whose transcript is gone.

Creating a husk also stamps its **provenance**: which engine ran the chat, and
which machine holds the transcript (`session/origin.ts`). Written at create
only — a value already on a card is never restamped.

```ts setup
import { mkdir, mkdtemp, rename, writeFile, readFile as readFsFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { ensureChatHusk, findChatHuskEntry, reconcileChatHusks, listChatHusks } from "../../src/core/chat/husk.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../src/core/chat/session/origin.js";

// Every husk written here records this machine's origin id; point that at a
// scratch file so a test run neither reads nor mints the real one.
process.env["CB_ORIGIN_ID_FILE"] = join(await mkdtemp(join(tmpdir(), "cb-origin-")), "origin-id");
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
engine: claude
origin: «*»
origin-name: «*»
---

const card = await box.read(path);
const { id, name } = await localOrigin();
card.includes(`origin: ${id}`) && card.includes(`origin-name: ${name}`)
=> true
```

## ensure is idempotent on the `session` field

Even with a different date: the field, not the file name, is the key.

```ts continue
await ensureChatHusk(box.root, {
  sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
  date: new Date("2026-08-01T12:00:00Z"),
})
=> store/chat/web/2026-07-02_59fc20dd.chat.card

(await findChatHuskEntry(box.root, "59fc20dd-fe6d-45cb-8f37-f1508a5a0869"))?.path ?? null
=> store/chat/web/2026-07-02_59fc20dd.chat.card

await findChatHuskEntry(box.root, "00000000-0000-4000-8000-000000000000")
=> null
```

Renaming the husk to a name with no `_<shortid>` suffix is safe — renaming is
encouraged once a chat's topic is clear, and it used to mint a **second** card
for the same session on the next resume after a server restart
(`issues/bugs/2026-07-28-renamed-husk-duplicates-on-backfill.md`). The suffix is
only a lookup hint; when it misses, the `session`-field scan finds the card.

```ts continue
await rename(box.path("store/chat/web/2026-07-02_59fc20dd.chat.card"), box.path("store/chat/web/Planning the trip.chat.card"));
await ensureChatHusk(box.root, {
  sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
  date: new Date("2026-08-01T12:00:00Z"),
})
=> store/chat/web/Planning the trip.chat.card

(await listChatHusks(box.root)).length
=> 1
```

## the snippet title strips every wrapper, not just `<chat-app>`

A stored user message is wrapped twice over: the `<chat-app …/>` snapshot tag
(`session/start.ts` prepends it) and the `<typed>`/`<speech>` shell the chat
adds, which carries the sender's name and email as attributes. A title sliced
from the raw text opens with markup instead of what the person said — and in the
`<typed>` case puts their **email address** into a committed card title and into
the session chip. So the title goes through `extractSnippet`, the one cleaning
step between a raw user message and a display label.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("projects");
const titled = "cccc1111-2222-3333-4444-555566667777";
const titledLog = getSessionLogPath(box.root, titled);
await mkdir(dirname(titledLog), { recursive: true });
await writeFile(titledLog, JSON.stringify({
  type: "user",
  message: { role: "user", content: [{ type: "text", text: '<chat-app narration="off" prose="on" local-time="Sunday 2026-08-23 10:29 CDT (morning)" channel="web-desktop"/>\nPlease reply with just the word ok.' }] },
}) + "\n");
const titledHusk = await ensureChatHusk(box.root, { sessionId: titled, date: new Date("2026-08-23T12:00:00Z") });
await box.read(titledHusk)
=> ---
session: cccc1111-2222-3333-4444-555566667777
engine: claude
origin: «*»
origin-name: «*»
title: Please reply with just the word ok.
---
```

A web-composer message — the shape that actually reaches a backfilled husk —
carries the `<typed>` shell with the sender's identity on it. None of that
belongs in the chat's name:

```ts continue
const web = "dddd1111-2222-3333-4444-555566667777";
const webLog = getSessionLogPath(box.root, web);
await mkdir(dirname(webLog), { recursive: true });
await writeFile(webLog, JSON.stringify({
  type: "user",
  message: { role: "user", content: [{ type: "text", text: '<chat-app narration="off" channel="web-desktop"/>\n<typed user="Ada Lovelace" user-email="ada@example.com">where did I put the drawer key?</typed>' }] },
}) + "\n");
const webHusk = await ensureChatHusk(box.root, { sessionId: web, date: new Date("2026-08-23T12:00:00Z") });
const card = await box.read(webHusk);
JSON.stringify({
  title: card.split("\n").find((l) => l.startsWith("title:")),
  leaksEmail: card.includes("ada@example.com"),
})
=> {"title":"title: where did I put the drawer key?","leaksEmail":false}
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
const huskPath = (await findChatHuskEntry(box.root, live))?.path ?? null;
huskPath !== null
=> true

await findChatHuskEntry(box.root, ghost)
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
(await findChatHuskEntry(box.root, late)) !== null
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

## reconcile warns about duplicate husks, and repairs nothing

Two husks claiming one session is no longer *created* — ensure is idempotent on
the field — but a box can still hold a pair from before that fix, from a copied
card, or from a hand-edit. `cb validate` errors on it, which only helps at
commit time; reconcile runs on every boot, so it says so once per duplicated
session, naming the paths. It doesn't pick a winner: which husk keeps the
chat's title and body is the boxholder's call.

```ts
const box = await makeTmpBox();
const dup = "59fc20dd-fe6d-45cb-8f37-f1508a5a0869";
await box.write("store/chat/web/2026-07-02_59fc20dd.chat.card", `---\nsession: ${dup}\n---\n`);
await box.write("store/chat/web/Copied.chat.card", `---\nsession: ${dup}\n---\n`);
await box.write("store/chat/web/2026-07-03_aaaa9999.chat.card",
  "---\nsession: aaaa9999-fe6d-45cb-8f37-f1508a5a0869\n---\n");

const warnings: string[] = [];
const original = console.warn;
console.warn = (msg: string) => { warnings.push(msg); };
await reconcileChatHusks(box.root);
console.warn = original;

warnings.join("\n")
=> chat-husk: 2 husks claim session 59fc20dd-fe6d-45cb-8f37-f1508a5a0869 (store/chat/web/2026-07-02_59fc20dd.chat.card, store/chat/web/Copied.chat.card) — keep one and `cb trash` the others

(await listChatHusks(box.root)).length
=> 3
```
