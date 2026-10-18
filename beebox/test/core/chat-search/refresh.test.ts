// # chat-search refresh + query: incremental index over chat transcripts
//
// The lazy refresh turns the box's chat husks and their engine transcripts
// into a chunk index (`src/core/chat-search/`). Fixtures seed Claude-format
// JSONL transcripts under `BBX_CLAUDE_PROJECTS_DIR` exactly the way the chat
// review discovery tests do; Codex sessions are exercised through the shared
// entry adapter elsewhere (its reader is the app-server RPC, not fixture
// files).

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { searchChats } from "../../../src/core/chat-search/query.js";
import { loadChatManifest } from "../../../src/core/chat-search/manifest.js";
import { saveChatManifest } from "../../../src/core/chat-search/manifest.js";
import { chatSearchStore } from "../../../src/core/chat-search/store.js";
import { indexPersistedFor } from "../../../src/core/search/store/index-store.js";

const T0 = new Date("2026-09-28T12:00:00Z");

function userEntry({ uuid, text, at }: { uuid: string; text: string; at: string }) {
  return { type: "user", uuid, timestamp: at, message: { role: "user", content: [{ type: "text", text }] } };
}

function assistantEntry({ uuid, text, at }: { uuid: string; text: string; at: string }) {
  return { type: "assistant", uuid, timestamp: at, message: { role: "assistant", content: [{ type: "text", text }] } };
}

async function seed(box: TmpBox, opts: {
  sessionId: string;
  entries: object[];
  mtime: Date;
  title?: string;
}) {
  const title = opts.title === undefined ? "" : `title: ${JSON.stringify(opts.title)}\n`;
  await box.write(
    `_content/chat/web/2026-09-28_${opts.sessionId}.chat.card`,
    `---\nsession: ${opts.sessionId}\nengine: claude\n${title}---\n\n`
  );
  await writeTranscript(box, { sessionId: opts.sessionId, entries: opts.entries, mtime: opts.mtime });
}

async function writeTranscript(box: TmpBox, { sessionId, entries, mtime }: { sessionId: string; entries: object[]; mtime: Date }) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await utimes(logPath, mtime, mtime);
}

// ## First query builds the index and finds the chat that said it
void test("First query builds the index and finds the chat that said it", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L56
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L59
  await seed(box, {
    sessionId: "sess-roof",
    entries: [
      userEntry({ uuid: "u1", text: "Did the insurance claim go through?", at: "2026-09-27T09:00:00Z" }),
      assistantEntry({ uuid: "a1", text: "Yes — the roof claim was approved on Tuesday.", at: "2026-09-27T09:01:00Z" }),
    ],
    mtime: T0,
    title: "Insurance follow-up",
  });

  // doctest:L69
  const result = await searchChats(box.root, { query: "roof claim" });

  // doctest:L71
  t.check(result.total, 1);

  // doctest:L74
  t.check(result.results[0]?.sessionId, "sess-roof");

  // doctest:L77
  t.check(result.results[0]?.anchor, "u1");

  // doctest:L80
  t.check(result.results[0]?.title, "Insurance follow-up");

  // doctest:L83
  t.check(result.results[0]?.snippet.includes("roof"), true);

  // doctest:L86
  t.check(result.stale, false);

  // The manifest recorded the cursor the next refresh diffs against.

  // doctest:L93
  const manifest = await loadChatManifest(box.root);
  const record = manifest.sessions["sess-roof"];

  // doctest:L96
  t.check({ engine: record?.engine, entryCount: record?.entryCount, docs: record?.docIds.length }, {
    engine: "claude",
    entryCount: 2,
    docs: 1,
  });

  // ## An appended turn is findable immediately, and only the new tail is chunked

  // doctest:L103
  await writeTranscript(box, {
    sessionId: "sess-roof",
    entries: [
      userEntry({ uuid: "u1", text: "Did the insurance claim go through?", at: "2026-09-27T09:00:00Z" }),
      assistantEntry({ uuid: "a1", text: "Yes — the roof claim was approved on Tuesday.", at: "2026-09-27T09:01:00Z" }),
      userEntry({ uuid: "u2", text: "What about the deductible on the solar panels?", at: "2026-09-28T11:00:00Z" }),
      assistantEntry({ uuid: "a2", text: "The panel deductible is separate: $500.", at: "2026-09-28T11:01:00Z" }),
    ],
    mtime: new Date("2026-09-28T12:05:00Z"),
  });

  // doctest:L115
  const updated = await searchChats(box.root, { query: "deductible panels" });

  // doctest:L117
  t.check(updated.total, 1);

  // doctest:L120
  t.check(updated.results[0]?.anchor, "u2");

  // doctest:L123
  const after = await loadChatManifest(box.root);
  const afterRecord = after.sessions["sess-roof"];

  // doctest:L126
  t.check(afterRecord?.entryCount, 4);

  // doctest:L129
  t.check(afterRecord?.docIds.length, 2);

  // The first chunk is untouched — its doc id is stable across the append, so
  // a persisted index only ever inserts.

  // doctest:L137
  t.check(afterRecord?.docIds[0], "sess-roof#u1");

  // doctest:L140
  t.check(afterRecord?.docIds.includes("sess-roof#u2"), true);

  // ## Two chats match: one row each, better score first

  // doctest:L147
  await seed(box, {
    sessionId: "sess-other",
    entries: [
      userEntry({ uuid: "v1", text: "Remind me to clean the panels on the roof this weekend.", at: "2026-09-20T09:00:00Z" }),
    ],
    mtime: new Date("2026-09-20T10:00:00Z"),
  });

  // doctest:L155
  const both = await searchChats(box.root, { query: "panels" });

  // doctest:L157
  t.check(both.total, 2);

  // doctest:L160
  await t.checkText(both.results.map((r) => r.sessionId).includes("sess-roof"), "true");

  // doctest:L163
  await t.checkText(both.results.map((r) => r.sessionId).includes("sess-other"), "true");

  // ## A rewritten (shortened) transcript rebuilds its session's docs

  // doctest:L170
  await writeTranscript(box, {
    sessionId: "sess-roof",
    entries: [userEntry({ uuid: "w1", text: "Fresh start: piano tuning.", at: "2026-09-28T12:00:00Z" })],
    mtime: new Date("2026-09-28T12:10:00Z"),
  });

  // doctest:L177
  const rebuilt = await searchChats(box.root, { query: "piano tuning" });

  // doctest:L179
  t.check(rebuilt.total, 1);

  // doctest:L182
  const rebuiltManifest = await loadChatManifest(box.root);

  // doctest:L184
  t.check(rebuiltManifest.sessions["sess-roof"]?.docIds, [
    "sess-roof#w1",
  ]);

  // The pre-rewrite material is gone from the index — old chunks pointed at a
  // transcript that no longer says it:

  // doctest:L192
  const gone = await searchChats(box.root, { query: "roof claim deductible" });

  // doctest:L194
  await t.checkText(gone.results.map((r) => r.sessionId).includes("sess-roof"), "false");

  // ## Deleting the husk drops the session's docs

  // doctest:L201
  await rm(box.path("_content/chat/web/2026-09-28_sess-other.chat.card"));

  // doctest:L203
  const afterDelete = await searchChats(box.root, { query: "panels" });

  // doctest:L205
  t.check(afterDelete.total, 0);

  // doctest:L208
  const finalManifest = await loadChatManifest(box.root);

  // doctest:L210
  t.check(Object.keys(finalManifest.sessions), [
    "sess-roof",
  ]);

  // ## A blank query matches nothing without touching the index

  // doctest:L217
  const blank = await searchChats(box.root, { query: "   " });

  // doctest:L219
  t.check({ total: blank.total, results: blank.results.length, stale: blank.stale }, {
    total: 0,
    results: 0,
    stale: false,
  });

  // The index is a disposable cache beside the manifest:

  // doctest:L226
  await t.checkText((await chatSearchStore.restore(box.root)) !== null, "true");

  // ## A crash between index and manifest persist re-converges (remove-before-insert)
  //
  // Append a turn, index it, then simulate the crash window the persist ordering
  // tolerates: rewrite the manifest to its pre-append state, as if the index had
  // been persisted but the manifest write never landed. The next refresh
  // recomputes the same chunk id and must re-insert it idempotently — a plain
  // insert would throw "already exists" and wedge the session's cursor forever
  // (the card index engineers the same convergence; `search/refresh/file.ts`).

  // doctest:L240
  await writeTranscript(box, {
    sessionId: "sess-roof",
    entries: [
      userEntry({ uuid: "w1", text: "Fresh start: piano tuning.", at: "2026-09-28T12:00:00Z" }),
      userEntry({ uuid: "w2", text: "Also get a garage door estimate.", at: "2026-09-28T13:00:00Z" }),
    ],
    mtime: new Date("2026-09-28T13:05:00Z"),
  });
  await searchChats(box.root, { query: "garage door estimate" });

  // doctest:L251
  const stale = await loadChatManifest(box.root);
  stale.sessions["sess-roof"] = {
    engine: "claude",
    huskPath: "_content/chat/web/2026-09-28_sess-roof.chat.card",
    mtimeMs: 0,
    entryCount: 1,
    docIds: ["sess-roof#w1"],
  };
  await saveChatManifest(box.root, { manifest: stale, indexProof: indexPersistedFor(box.root) });

  // doctest:L261
  const converged = await searchChats(box.root, { query: "garage door estimate" });

  // doctest:L263
  t.check(converged.total, 1);

  // doctest:L266
  await t.checkText(converged.warnings.length, "0");

  // doctest:L269
  t.check((await loadChatManifest(box.root)).sessions["sess-roof"]?.entryCount, 2);
});
