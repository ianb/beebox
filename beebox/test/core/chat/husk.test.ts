// # Chat husks — a `chat` card per web chat session
//
// `ensureChatHusk` creates the session's card under `_content/chat/web/`
// (docs/plans/chat-husks.md): identity + editorial only, keyed on the
// `session` field — the `_<shortid>.chat.card` filename is a naming
// convention and a lookup hint, nothing more.
// `reconcileChatHusks` gives every history entry a husk, skipping ghosts
// whose transcript is gone.
//
// Creating a husk also stamps its **provenance**: which engine ran the chat, and
// which machine holds the transcript (`session/origin.ts`). Written at create
// only — a value already on a card is never restamped.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
import { mkdir, rename, writeFile, readFile as readFsFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { ensureChatHusk, reconcileChatHusks } from "../../../src/core/chat/husk.js";
import { findChatHuskEntry, listChatHusks } from "../../../src/core/chat/husk-read.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../../src/core/chat/session/origin.js";

const { id, name } = await localOrigin();

/** A husk entry as the listing reads it: stamped with this machine's origin. */
const stamped = (husk: { path: string | ReturnType<typeof str>; session: string; contextDir?: string }) => ({
  ...husk,
  engine: "claude" as const,
  origin: id,
  originName: name,
});

/** A husk path named for today (the reconcile pass dates the file by the clock). */
const today = (short: string) => str`_content/chat/web/${any(String).matches(/^\d{4}-\d{2}-\d{2}$/)}_${short}.chat.card`;

// ## ensure creates the husk, named by date + short session id
//
// The `session` field carries the association; there is no activity state
// on the card. A brand-new session has no readable transcript yet, so the
// husk starts untitled.
void test("The session field carries the association; there is no activity state on the...", async (t) => {
  // doctest:L31
  const box = await makeTmpBox();
  const path = await ensureChatHusk(box.root, {
    sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
    contextDir: "_content/projects",
    date: new Date("2026-07-02T12:00:00Z"),
  });
  t.check(path, "_content/chat/web/2026-07-02_59fc20dd.chat.card");

  // doctest:L40
  t.checkText(await box.read(path), `---
session: 59fc20dd-fe6d-45cb-8f37-f1508a5a0869
context-dir: _content/projects
engine: claude
origin: ${id}
origin-name: ${name}
---`);

  // ## ensure is idempotent on the `session` field
  //
  // Even with a different date: the field, not the file name, is the key.

  // doctest:L60
  t.check(
    await ensureChatHusk(box.root, {
      sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
      date: new Date("2026-08-01T12:00:00Z"),
    }),
    "_content/chat/web/2026-07-02_59fc20dd.chat.card",
  );

  // doctest:L66
  t.check(
    await findChatHuskEntry(box.root, "59fc20dd-fe6d-45cb-8f37-f1508a5a0869"),
    stamped({ path: "_content/chat/web/2026-07-02_59fc20dd.chat.card", session: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869", contextDir: "_content/projects" }),
  );

  // doctest:L69
  t.check(await findChatHuskEntry(box.root, "00000000-0000-4000-8000-000000000000"), null);

  // Renaming the husk to a name with no `_<shortid>` suffix is safe — renaming is
  // encouraged once a chat's topic is clear, and it used to mint a **second** card
  // for the same session on the next resume after a server restart
  // (`issues/bugs/2026-07-28-renamed-husk-duplicates-on-backfill.md`). The suffix is
  // only a lookup hint; when it misses, the `session`-field scan finds the card.

  // doctest:L80
  await rename(box.path("_content/chat/web/2026-07-02_59fc20dd.chat.card"), box.path("_content/chat/web/Planning the trip.chat.card"));
  t.check(
    await ensureChatHusk(box.root, {
      sessionId: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869",
      date: new Date("2026-08-01T12:00:00Z"),
    }),
    "_content/chat/web/Planning the trip.chat.card",
  );

  // doctest:L87
  t.check(await listChatHusks(box.root), [
    stamped({ path: "_content/chat/web/Planning the trip.chat.card", session: "59fc20dd-fe6d-45cb-8f37-f1508a5a0869", contextDir: "_content/projects" }),
  ]);
});

// ## the snippet title strips every wrapper, not just `<chat-app>`
//
// A stored user message is wrapped twice over: the `<chat-app …/>` snapshot tag
// (`session/start.ts` prepends it) and the `<typed>`/`<speech>` shell the chat
// adds, which carries the sender's name and email as attributes. A title sliced
// from the raw text opens with markup instead of what the person said — and in the
// `<typed>` case puts their **email address** into a committed card title and into
// the session chip. So the title goes through `extractSnippet`, the one cleaning
// step between a raw user message and a display label.
void test("A stored user message is wrapped twice over:", async (t) => {
  // doctest:L102
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");
  const titled = "cccc1111-2222-3333-4444-555566667777";
  const titledLog = getSessionLogPath(box.root, titled);
  await mkdir(dirname(titledLog), { recursive: true });
  await writeFile(titledLog, JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: '<chat-app narration="off" prose="on" local-time="Sunday 2026-08-23 10:29 CDT (morning)" channel="web-desktop"/>\nPlease reply with just the word ok.' }] },
  }) + "\n");
  const titledHusk = await ensureChatHusk(box.root, { sessionId: titled, date: new Date("2026-08-23T12:00:00Z") });
  t.checkText(await box.read(titledHusk), `---
session: cccc1111-2222-3333-4444-555566667777
engine: claude
origin: ${id}
origin-name: ${name}
first-message: Please reply with just the word ok.
---`);

  // A web-composer message — the shape that actually reaches a backfilled husk —
  // carries the `<typed>` shell with the sender's identity on it. None of that
  // belongs in the stored snippet:

  // doctest:L127
  const web = "dddd1111-2222-3333-4444-555566667777";
  const webLog = getSessionLogPath(box.root, web);
  await mkdir(dirname(webLog), { recursive: true });
  await writeFile(webLog, JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: '<chat-app narration="off" channel="web-desktop"/>\n<typed user="Rosa Okafor" user-email="rosa@example.com">where did I put the drawer key?</typed>' }] },
  }) + "\n");
  const webHusk = await ensureChatHusk(box.root, { sessionId: web, date: new Date("2026-08-23T12:00:00Z") });
  t.checkText(await box.read(webHusk), `---
session: dddd1111-2222-3333-4444-555566667777
engine: claude
origin: ${id}
origin-name: ${name}
first-message: where did I put the drawer key?
---`);
});

// ## reconcile husks every history entry, skipping ghosts
//
// Transcript discovery honors `BBX_CLAUDE_PROJECTS_DIR`; a history entry
// whose JSONL is gone (a "ghost") gets no husk.
void test("Transcript discovery honors BBXCLAUDEPROJECTSDIR; a history entry whose JSONL...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L150
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");
  const live = "aaaa1111-2222-3333-4444-555566667777";
  const ghost = "bbbb1111-2222-3333-4444-555566667777";
  await box.write(".beebox/chat-session-history.json", JSON.stringify({
    sessions: [{ id: live, contextDir: "" }, { id: ghost }],
    migrated: true,
  }));
  const logPath = getSessionLogPath(box.root, live);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "{}\n");

  // doctest:L162
  await reconcileChatHusks(box.root);
  const liveHusk = await findChatHuskEntry(box.root, live);
  t.check(liveHusk, stamped({ path: today("aaaa1111"), session: live }));

  // doctest:L167
  t.check(await findChatHuskEntry(box.root, ghost), null);

  // doctest:L170
  t.checkText(await readFsFile(box.path(liveHusk?.path ?? ""), "utf-8"), `---
session: ${live}
engine: claude
origin: ${id}
origin-name: ${name}
---`);

  // It re-runs on every boot rather than once behind a marker, so a session
  // that never got its husk — the assignment-time write is best-effort, and the
  // history backfill may still have been writing entries during an earlier pass —
  // is repaired by the next one instead of staying invisible forever.

  // doctest:L180
  const late = "cccc1111-2222-3333-4444-555566667777";
  const lateLog = getSessionLogPath(box.root, late);
  await mkdir(dirname(lateLog), { recursive: true });
  await writeFile(lateLog, "{}\n");
  await box.write(".beebox/chat-session-history.json", JSON.stringify({
    sessions: [{ id: live }, { id: late }],
    migrated: true,
  }));

  // doctest:L189
  await reconcileChatHusks(box.root);
  t.check(await findChatHuskEntry(box.root, late), stamped({ path: today("cccc1111"), session: late }));

  // An already-husked session is left exactly as it was — no duplicate card.

  // doctest:L197
  const before = await listChatHusks(box.root);
  await reconcileChatHusks(box.root);
  const again = await listChatHusks(box.root);
  const both = [stamped({ path: today("aaaa1111"), session: live }), stamped({ path: today("cccc1111"), session: late })];
  t.check(before, both);
  t.check(again, both);
});

// ## listChatHusks enumerates the cards — they ARE the session list
//
// The picker reads husks, not the history file: a `title` on the card wins
// over any transcript snippet, and a deleted husk means the session is
// editorially gone from the picker. Files without a `session` field are
// skipped.
void test("The picker reads husks, not the history file:", async (t) => {
  // doctest:L216
  const box = await makeTmpBox();
  await ensureChatHusk(box.root, {
    sessionId: "aaaa1111-0000-0000-0000-000000000000",
    contextDir: "_content/projects",
    date: new Date("2026-07-01T12:00:00Z"),
  });
  await box.write("_content/chat/web/renamed-topic_bbbb2222.chat.card", `---
session: bbbb2222-0000-0000-0000-000000000000
title: Planning the garden
---
`);
  await box.write("_content/chat/web/broken.chat.card", "no frontmatter here\n");
  const husks = await listChatHusks(box.root);
  t.check(husks, [
    stamped({ path: "_content/chat/web/2026-07-01_aaaa1111.chat.card", session: "aaaa1111-0000-0000-0000-000000000000", contextDir: "_content/projects" }),
    { path: "_content/chat/web/renamed-topic_bbbb2222.chat.card", session: "bbbb2222-0000-0000-0000-000000000000", title: "Planning the garden" },
  ]);
});

// ## reconcile warns about duplicate husks, and repairs nothing
//
// Two husks claiming one session is no longer *created* — ensure is idempotent on
// the field — but a box can still hold a pair from before that fix, from a copied
// card, or from a hand-edit. `bbx validate` errors on it, which only helps at
// commit time; reconcile runs on every boot, so it says so once per duplicated
// session, naming the paths. It doesn't pick a winner: which husk keeps the
// chat's title and body is the boxholder's call.
void test("Two husks claiming one session is no longer created — ensure is idempotent on...", async (t) => {
  // doctest:L255
  const box = await makeTmpBox();
  const dup = "59fc20dd-fe6d-45cb-8f37-f1508a5a0869";
  await box.write("_content/chat/web/2026-07-02_59fc20dd.chat.card", `---\nsession: ${dup}\n---\n`);
  await box.write("_content/chat/web/Copied.chat.card", `---\nsession: ${dup}\n---\n`);
  await box.write("_content/chat/web/2026-07-03_aaaa9999.chat.card",
    "---\nsession: aaaa9999-fe6d-45cb-8f37-f1508a5a0869\n---\n");

  // doctest:L262
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => { warnings.push(msg); };
  await reconcileChatHusks(box.root);
  console.warn = original;

  // doctest:L268
  t.check(warnings, ["chat-husk: 2 husks claim session 59fc20dd-fe6d-45cb-8f37-f1508a5a0869 (_content/chat/web/2026-07-02_59fc20dd.chat.card, _content/chat/web/Copied.chat.card) — keep one and `bbx trash` the others"]);

  // doctest:L271
  t.check(await listChatHusks(box.root), [
    { path: "_content/chat/web/2026-07-02_59fc20dd.chat.card", session: dup },
    { path: "_content/chat/web/2026-07-03_aaaa9999.chat.card", session: "aaaa9999-fe6d-45cb-8f37-f1508a5a0869" },
    { path: "_content/chat/web/Copied.chat.card", session: dup },
  ]);
});

// ## reconcile backfills provenance for husks written before it existed
//
// A husk from before `origin` existed gets it on the first boot of the machine
// that holds its transcript — the transcript IS the evidence, and a session's
// engine store exists on exactly one machine, so two checkouts can never stamp
// the same husk. `engine` comes from the history entry — this one has none, which
// decodes as `claude`, as everywhere else. The body, the title and every other field are
// carried through untouched, and a second pass writes nothing.
void test("A husk from before origin existed gets it on the first boot of the machine th...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L285
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");
  const here = "eeee1111-2222-3333-4444-555566667777";
  const away = "ffff1111-2222-3333-4444-555566667777";
  await box.write("_content/chat/web/Kitchen redo.chat.card", `---
session: ${here}
title: Kitchen redo
---
Decided on the tile in this chat.
`);
  await box.write("_content/chat/web/Old trip.chat.card", `---
session: ${away}
title: Old trip
---
`);
  await box.write(".beebox/chat-session-history.json", JSON.stringify({
    sessions: [{ id: here }, { id: away }],
    migrated: true,
  }));
  const hereLog = getSessionLogPath(box.root, here);
  await mkdir(dirname(hereLog), { recursive: true });
  await writeFile(hereLog, "{}\n");

  await reconcileChatHusks(box.root);
  // doctest:L308
  t.checkText(await box.read("_content/chat/web/Kitchen redo.chat.card"), `---
session: eeee1111-2222-3333-4444-555566667777
title: Kitchen redo
origin: ${id}
origin-name: ${name}
engine: claude
---
Decided on the tile in this chat.`);

  // The other husk's transcript is on some other machine (or expired), so it stays
  // unstamped — "unknown" is honest, and a guessed origin would make an expired
  // chat look like it lives somewhere it doesn't.

  // doctest:L325
  t.checkText(await box.read("_content/chat/web/Old trip.chat.card"), `---
session: ffff1111-2222-3333-4444-555566667777
title: Old trip
---`);

  // doctest:L331
  const kitchen = await box.read("_content/chat/web/Kitchen redo.chat.card");
  await reconcileChatHusks(box.root);
  t.check(await box.read("_content/chat/web/Kitchen redo.chat.card"), kitchen);
});
