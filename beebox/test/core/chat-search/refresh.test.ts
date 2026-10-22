// # chat-search refresh + query: incremental index over chat transcripts
//
// The lazy refresh turns the box's chat husks and their engine transcripts
// into a chunk index (`src/core/chat-search/`). Fixtures seed Claude-format
// JSONL transcripts under `BBX_CLAUDE_PROJECTS_DIR` exactly the way the chat
// review discovery tests do; Codex sessions are exercised through the shared
// entry adapter elsewhere (its reader is the app-server RPC, not fixture
// files).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
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

const ROOF_U1 = {
  sessionId: "sess-roof",
  anchor: "u1",
  title: "Insurance follow-up",
  snippet: "Did the insurance claim go through? Yes — the roof claim was approved on Tuesday.",
  created: "2026-09-27T09:00:00Z",
  score: 0.3063627265070913,
};
const ROOF_U2 = {
  sessionId: "sess-roof",
  anchor: "u2",
  title: "Insurance follow-up",
  snippet: "What about the deductible on the solar panels? The panel deductible is separate: $500.",
  created: "2026-09-28T11:00:00Z",
};
const OTHER_V1 = {
  sessionId: "sess-other",
  anchor: "v1",
  title: "",
  snippet: "Remind me to clean the panels on the roof this weekend.",
  created: "2026-09-20T09:00:00Z",
};
const NO_HITS = { results: [], total: 0, truncated: false, warnings: [], stale: false };
const roofRecord = ({ mtimeMs, entryCount, docIds }: { mtimeMs: number; entryCount: number; docIds: string[] }) => ({
  engine: "claude" as const,
  huskPath: "_content/chat/web/2026-09-28_sess-roof.chat.card",
  mtimeMs,
  entryCount,
  docIds,
});
const otherRecord = {
  engine: "claude" as const,
  huskPath: "_content/chat/web/2026-09-28_sess-other.chat.card",
  mtimeMs: 1789898400000,
  entryCount: 1,
  docIds: ["sess-other#v1"],
};

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
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  await seed(box, {
    sessionId: "sess-roof",
    entries: [
      userEntry({ uuid: "u1", text: "Did the insurance claim go through?", at: "2026-09-27T09:00:00Z" }),
      assistantEntry({ uuid: "a1", text: "Yes — the roof claim was approved on Tuesday.", at: "2026-09-27T09:01:00Z" }),
    ],
    mtime: T0,
    title: "Insurance follow-up",
  });

  const result = await searchChats(box.root, { query: "roof claim" });

  t.check(result, { results: [ROOF_U1], total: 1, truncated: false, warnings: [], stale: false });

  // The manifest recorded the cursor the next refresh diffs against.

  const manifest = await loadChatManifest(box.root);

  t.check(manifest, { schemaVersion: 1, sessions: { "sess-roof": roofRecord({ mtimeMs: 1790596800000, entryCount: 2, docIds: ["sess-roof#u1"] }) } });

  // ## An appended turn is findable immediately, and only the new tail is chunked

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

  const updated = await searchChats(box.root, { query: "deductible panels" });

  // The first chunk is untouched — its doc id is stable across the append, so
  // a persisted index only ever inserts.
  t.check(updated, {
    results: [{ ...ROOF_U2, score: 0.7752217598810629 }],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
  });
  t.check(await loadChatManifest(box.root), {
    schemaVersion: 1,
    sessions: { "sess-roof": roofRecord({ mtimeMs: 1790597100000, entryCount: 4, docIds: ["sess-roof#u1", "sess-roof#u2"] }) },
  });

  // ## Two chats match: one row each, better score first

  await seed(box, {
    sessionId: "sess-other",
    entries: [
      userEntry({ uuid: "v1", text: "Remind me to clean the panels on the roof this weekend.", at: "2026-09-20T09:00:00Z" }),
    ],
    mtime: new Date("2026-09-20T10:00:00Z"),
  });

  const both = await searchChats(box.root, { query: "panels" });

  t.check(both, {
    results: [
      { ...OTHER_V1, score: 0.2777931898228526 },
      { ...ROOF_U2, score: 0.2548611229008566 },
    ],
    total: 2,
    truncated: false,
    warnings: [],
    stale: false,
  });

  // ## A rewritten (shortened) transcript rebuilds its session's docs

  await writeTranscript(box, {
    sessionId: "sess-roof",
    entries: [userEntry({ uuid: "w1", text: "Fresh start: piano tuning.", at: "2026-09-28T12:00:00Z" })],
    mtime: new Date("2026-09-28T12:10:00Z"),
  });

  const rebuilt = await searchChats(box.root, { query: "piano tuning" });

  t.check(rebuilt, {
    results: [
      {
        sessionId: "sess-roof",
        anchor: "w1",
        title: "Insurance follow-up",
        snippet: "Fresh start: piano tuning.",
        created: "2026-09-28T12:00:00Z",
        score: 1.3676863831182813,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
  });
  t.check(await loadChatManifest(box.root), {
    schemaVersion: 1,
    sessions: { "sess-roof": roofRecord({ mtimeMs: 1790597400000, entryCount: 1, docIds: ["sess-roof#w1"] }), "sess-other": otherRecord },
  });

  // The pre-rewrite material is gone from the index — old chunks pointed at a
  // transcript that no longer says it:

  const gone = await searchChats(box.root, { query: "roof claim deductible" });

  t.check(gone, {
    results: [{ ...OTHER_V1, score: 0.29605608390018 }],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
  });

  // ## Deleting the husk drops the session's docs

  await rm(box.path("_content/chat/web/2026-09-28_sess-other.chat.card"));

  const afterDelete = await searchChats(box.root, { query: "panels" });

  t.check(afterDelete, NO_HITS);
  t.check(await loadChatManifest(box.root), {
    schemaVersion: 1,
    sessions: { "sess-roof": roofRecord({ mtimeMs: 1790597400000, entryCount: 1, docIds: ["sess-roof#w1"] }) },
  });

  // ## A blank query matches nothing without touching the index

  const blank = await searchChats(box.root, { query: "   " });

  t.check(blank, NO_HITS);

  // The index is a disposable cache beside the manifest:

  t.check(await chatSearchStore.restore(box.root), not(null));

  // ## A crash between index and manifest persist re-converges (remove-before-insert)
  //
  // Append a turn, index it, then simulate the crash window the persist ordering
  // tolerates: rewrite the manifest to its pre-append state, as if the index had
  // been persisted but the manifest write never landed. The next refresh
  // recomputes the same chunk id and must re-insert it idempotently — a plain
  // insert would throw "already exists" and wedge the session's cursor forever
  // (the card index engineers the same convergence; `search/refresh/file.ts`).

  await writeTranscript(box, {
    sessionId: "sess-roof",
    entries: [
      userEntry({ uuid: "w1", text: "Fresh start: piano tuning.", at: "2026-09-28T12:00:00Z" }),
      userEntry({ uuid: "w2", text: "Also get a garage door estimate.", at: "2026-09-28T13:00:00Z" }),
    ],
    mtime: new Date("2026-09-28T13:05:00Z"),
  });
  await searchChats(box.root, { query: "garage door estimate" });

  const stale = await loadChatManifest(box.root);
  stale.sessions["sess-roof"] = {
    engine: "claude",
    huskPath: "_content/chat/web/2026-09-28_sess-roof.chat.card",
    mtimeMs: 0,
    entryCount: 1,
    docIds: ["sess-roof#w1"],
  };
  await saveChatManifest(box.root, { manifest: stale, indexProof: indexPersistedFor(box.root) });

  const converged = await searchChats(box.root, { query: "garage door estimate" });

  t.check(converged, {
    results: [{ sessionId: "sess-roof", anchor: "w2", title: "Insurance follow-up", snippet: "Also get a garage door estimate.", created: "2026-09-28T13:00:00Z", score: 1.165204312148184 }],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
  });
  t.check(await loadChatManifest(box.root), {
    schemaVersion: 1,
    sessions: { "sess-roof": roofRecord({ mtimeMs: 1790600700000, entryCount: 2, docIds: ["sess-roof#w1", "sess-roof#w2"] }) },
  });
});
