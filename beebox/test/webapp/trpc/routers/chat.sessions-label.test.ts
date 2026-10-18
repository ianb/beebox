// # `chat.sessions`: one enumeration and one labelling order for every session list
//
// There used to be two session-list codepaths that disagreed. `chat.byLandmark`
// (the landmark picker) enumerates husk cards and reads the husk's `title`;
// `chat.sessions` — the query the chat history dropdown actually calls — read the
// history JSON and never looked at a husk at all, so a title set by hand or written
// by the nightly chat review was invisible where it mattered most, and a husk the
// boxholder deleted vanished from the picker but lingered in the dropdown.
//
// Both now go through `loadAllSessions` (husk cards are the source of truth for
// which chats exist) and `resolveSessionLabel` (husk `title`, then the
// transcript's first user message, then the session-id prefix).

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot });
  return appRouter.createCaller(ctx);
}

async function seedTranscript(boxRoot: string, { sessionId, firstMessage }: { sessionId: string; firstMessage: string }) {
  const logPath = getSessionLogPath(boxRoot, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  const entry = {
    type: "user",
    uuid: `u-${sessionId}`,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: firstMessage }] },
  };
  await writeFile(logPath, JSON.stringify(entry) + "\n");
}

// ## A husk title beats the first-message snippet
void test("A husk title beats the first-message snippet", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L45
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L48
  await seedTranscript(box.root, { sessionId: "titled01", firstMessage: "hey can you look at the thing from yesterday" });
  await seedTranscript(box.root, { sessionId: "untitled1", firstMessage: "what's on my calendar tomorrow" });

  // doctest:L51
  // Both sessions have a husk; only the first one carries a title.
  await box.write("_content/chat/web/2026-07-28_titled01.chat.card",
    "---\nsession: titled01\ntitle: Chasing down a duplicate charge\n---\n\n");
  await box.write("_content/chat/web/2026-07-28_untitled1.chat.card",
    "---\nsession: untitled1\n---\n\n");

  // doctest:L57
  const { sessions } = await caller(box.root).chat.sessions();
  await t.checkText(sessions.map((s) => `${s.sessionId}: ${s.label}`).toSorted().join("\n"), `titled01: Chasing down a duplicate charge
untitled1: “what's on my calendar tomorrow”`);

  // ## Husks are the enumeration, so the two lists can't drift
  //
  // A session with a transcript but no husk is not listed — deleting a husk is
  // editorial removal from the dropdown, the same as from the picker. (The history
  // JSON no longer decides membership; husks are written eagerly when a session id
  // is assigned, and pre-husk history is backfilled once on boot.)

  // doctest:L72
  await seedTranscript(box.root, { sessionId: "huskless", firstMessage: "this one has no card" });
  await box.write(".beebox/chat-session-history.json",
    JSON.stringify({ sessions: [{ id: "titled01" }, { id: "huskless" }] }, null, 2));

  // doctest:L76
  const listed = await caller(box.root).chat.sessions();
  await t.checkText(listed.sessions.some((s) => s.sessionId === "huskless"), "false");

  // A husk whose transcript is gone is skipped too — there's nothing to resume,
  // though the card stays browsable.

  // doctest:L85
  await box.write("_content/chat/web/2026-07-28_notrans1.chat.card",
    "---\nsession: notrans1\n---\n\n");

  // doctest:L88
  const stillGone = await caller(box.root).chat.sessions();
  await t.checkText(stillGone.sessions.some((s) => s.sessionId === "notrans1"), "false");

  // A session whose transcript exists but can't be parsed still lists — it falls
  // back to the id prefix rather than failing the whole list. (Expect a
  // `skipping unparseable JSONL line` warning below; that's the fixture.)

  // doctest:L98
  await mkdir(dirname(getSessionLogPath(box.root, "garbled9")), { recursive: true });
  await writeFile(getSessionLogPath(box.root, "garbled9"), "not json at all\n");
  await box.write("_content/chat/web/2026-07-28_garbled9.chat.card",
    "---\nsession: garbled9\n---\n\n");

  // doctest:L103
  const garbled = await caller(box.root).chat.sessions();
  t.check(garbled.sessions.find((s) => s.sessionId === "garbled9")?.label, "garbled9");
});

// ## Each row carries its landmark, so the dropdown can group by it
//
// `contextDir` is the session's binding ("" for root-bound and for legacy sessions
// that predate bindings); `landmarkLabel` is that landmark's display name,
// resolved server-side so the dropdown doesn't have to.
void test("contextDir is the session's binding (\"\" for root-bound and for legacy session...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L119
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L122
  await box.write("_content/recipes/Recipes.landmark.card",
    "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Recipes\n---\n\n");

  // doctest:L125
  await seedTranscript(box.path("_content/recipes"), { sessionId: "inrecipe1", firstMessage: "what can I make with lentils" });
  await seedTranscript(box.root, { sessionId: "rootchat1", firstMessage: "how's my week looking" });

  // doctest:L128
  await box.write("_content/chat/web/2026-07-28_inrecipe1.chat.card",
    "---\nsession: inrecipe1\ncontext-dir: _content/recipes\n---\n\n");
  await box.write("_content/chat/web/2026-07-28_rootchat1.chat.card",
    "---\nsession: rootchat1\n---\n\n");

  // doctest:L133
  const { sessions } = await caller(box.root).chat.sessions();
  await t.checkText(sessions.map((s) => `${s.sessionId} [${s.contextDir}] ${s.landmarkLabel}`).toSorted().join("\n"), `inrecipe1 [_content/recipes] Recipes
rootchat1 [] Root`);

  // A session bound to a directory with no landmark card (deleted, or never one)
  // still says where it lives — the directory itself is the fallback label.

  // doctest:L144
  await seedTranscript(box.path("_content/orphan"), { sessionId: "orphaned1", firstMessage: "leftover thread" });
  await box.write("_content/chat/web/2026-07-28_orphaned1.chat.card",
    "---\nsession: orphaned1\ncontext-dir: _content/orphan\n---\n\n");

  // doctest:L148
  const after = await caller(box.root).chat.sessions();
  const orphan = after.sessions.find((s) => s.sessionId === "orphaned1");
  assert.ok(orphan);
  t.check(`${orphan.contextDir} / ${orphan.landmarkLabel}`, "_content/orphan / _content/orphan");
});
