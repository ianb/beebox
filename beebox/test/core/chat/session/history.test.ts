// # Chat Session History
//
// `chat-session-history.json` tracks which native session ids belong to web chat
// for this box, their owning engine, and an optional per-session `contextDir`
// association used by landmark-started chats. Missing engine values are legacy
// Claude entries.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import {
  loadHistory,
  loadHistoryEntries,
  appendHistory,
  getDirectoryForSession,
  resolveSessionLogPath,
  sessionLogPathFor,
  removeSessionFromHistory,
  clearMostActiveIfMatches,
  getMostActive,
  getMostActiveSavedAt,
  setMostActive,
} from "../../../../src/core/chat/session/history.js";
import { getLastSessionForDirectory } from "../../../../src/core/chat/session/last-session.js";
import { getSessionDir, getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { resolveChatEngine } from "../../../../src/core/chat/session/engine.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

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

// ## Engine ownership
//
// Legacy entries remain Claude-owned, while an explicit Codex entry stays pinned
// to Codex regardless of the current box default.
void test("Legacy entries remain Claude-owned, while an explicit Codex entry stays pinne...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    ".beebox/chat-session-history.json",
    JSON.stringify({ sessions: [{ id: "old" }, { id: "new", engine: "codex" }], migrated: true }),
  );
  t.check(
    [
      await resolveChatEngine(box.root, { sessionId: "old" }),
      await resolveChatEngine(box.root, { sessionId: "new" }),
    ],
    [
    "claude",
    "codex",
  ],
  );
});

// ## The husk's `engine` stamp outranks the per-checkout history file
//
// The history file is per-checkout; the husk card travels with the box. So a
// Codex chat opened on a machine that never ran it has a stamped husk and no
// history entry at all — and reading that as Claude would send the resume down
// the wrong SDK.
void test("The history file is per-checkout; the husk card travels with the box.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const codexSession = "0198f0b0-1111-7111-8111-111111111111";
  const box = await makeTmpBox();
  await box.write(
    `_content/chat/web/2026-08-26_${codexSession.slice(0, 8)}.chat.card`,
    `---\nsession: ${codexSession}\nengine: codex\n---\n`,
  );
  t.check(await resolveChatEngine(box.root, { sessionId: codexSession }), "codex");

  // A value that isn't an engine we run is a hand-edit: it warns and reads as
  // absent, so resolution falls through to the history entry rather than carrying
  // a nonsense string into engine dispatch.

  const junkSession = "0198f0b0-2222-7222-8222-222222222222";
  await box.write(
    `_content/chat/web/2026-08-26_${junkSession.slice(0, 8)}.chat.card`,
    `---\nsession: ${junkSession}\nengine: gpt-9\n---\n`,
  );
  await box.write(
    ".beebox/chat-session-history.json",
    JSON.stringify({ sessions: [{ id: junkSession, engine: "codex" }], migrated: true }),
  );
  t.check(await resolveChatEngine(box.root, { sessionId: junkSession }), "codex");
});

// ## Deletion removes exact duplicates and conditionally clears the pointer
//
// Removal is idempotent, preserves unrelated rows and the migration marker, and
// clears the most-active id without erasing its activity timestamp.
void test("Removal is idempotent, preserves unrelated rows and the migration marker, and...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    ".beebox/chat-session-history.json",
    JSON.stringify({ sessions: [{ id: "keep" }, { id: "gone" }, { id: "gone", contextDir: "_content/x" }], migrated: true }),
  );
  await setMostActive(box.root, "gone");
  const savedAt = await getMostActiveSavedAt(box.root);
  const removed = await removeSessionFromHistory(box.root, "gone");
  await clearMostActiveIfMatches(box.root, "gone");
  t.check({ removed, ids: await loadHistory(box.root), active: await getMostActive(box.root) }, {
    removed: [{ id: "gone", engine: "claude" }, { id: "gone", engine: "claude", contextDir: "_content/x" }],
    ids: [
      "keep",
    ],
    active: null,
  });

  t.check(await getMostActiveSavedAt(box.root), savedAt);

  // A newer pointer wins the compare-and-clear race:

  await setMostActive(box.root, "newer");
  await clearMostActiveIfMatches(box.root, "gone");
  t.check(await getMostActive(box.root), "newer");
});

// ## Reading a v1 file
//
// A legacy file with `sessionIds: [...]` reads back as entries with no `contextDir`. The migration is lazy — the file isn't rewritten until something appends.
void test("A legacy file with sessionIds:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    ".beebox/chat-session-history.json",
    JSON.stringify({ sessionIds: ["abc", "def"], migrated: true }),
  );

  t.check(await loadHistoryEntries(box.root), [
    {
      id: "abc",
      engine: "claude",
    },
    {
      id: "def",
      engine: "claude",
    },
  ]);

  t.check(await loadHistory(box.root), [
    "abc",
    "def",
  ]);
});

// ## Migrating on first write
//
// Once `appendHistory` runs against a v1 file, it writes the new shape. v2 files round-trip unchanged.
void test("Once appendHistory runs against a v1 file, it writes the new shape.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write(
    ".beebox/chat-session-history.json",
    JSON.stringify({ sessionIds: ["abc"], migrated: true }),
  );

  await appendHistory(box.root, { sessionId: "def" });

  const raw = await readFile(join(box.root, ".beebox/chat-session-history.json"), "utf-8");
  const parsed = JSON.parse(raw);
  t.check(parsed, {
    sessions: [
      {
        id: "abc",
        engine: "claude",
      },
      {
        id: "def",
        engine: "claude",
      },
    ],
    migrated: true,
  });
});

// ## appendHistory is idempotent on sessionId
//
// A second call with the same id is a no-op.
void test("A second call with the same id is a no-op.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "abc" });
  await appendHistory(box.root, { sessionId: "abc" });

  t.check(await loadHistory(box.root), ["abc"]);
});

// ## appendHistory backfills a missing contextDir
//
// When a session was first added without a `contextDir` (e.g. via the
// registry's `onSessionIdAssigned` hook) and a later call supplies one,
// the existing entry is updated rather than duplicated.
void test("When a session was first added without a contextDir (e.g.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "abc" });
  await appendHistory(box.root, { sessionId: "abc", contextDir: "_content/recipes" });

  t.check(await loadHistoryEntries(box.root), [
    {
      id: "abc",
      engine: "claude",
      contextDir: "_content/recipes",
    },
  ]);
});

// ## appendHistory does not clobber an existing contextDir
//
// Once a session is bound to a directory, the binding is durable — a
// later call with a different `contextDir` is ignored. Rebinding isn't
// supported in v1.
void test("Once a session is bound to a directory, the binding is durable — a later call...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "abc", contextDir: "_content/recipes" });
  await appendHistory(box.root, { sessionId: "abc", contextDir: "_content/todos" });

  t.check(await getDirectoryForSession(box.root, "abc"), "_content/recipes");
});

// ## getDirectoryForSession returns null for unbound and unknown sessions
void test("getDirectoryForSession returns null for unbound and unknown sessions", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "abc", contextDir: "_content/recipes" });
  await appendHistory(box.root, { sessionId: "def" });

  t.check(await getDirectoryForSession(box.root, "abc"), "_content/recipes");

  t.check(await getDirectoryForSession(box.root, "def"), null);

  t.check(await getDirectoryForSession(box.root, "ghi"), null);
});

// ## The box-root binding survives a read
//
// `""` is the box-root landmark, and a chat opened from the Box row is bound to
// it as much as one opened from any other landmark. The reader used to drop an
// empty `contextDir` as if it were absent, which meant a root-bound chat came
// back unbound — so the app bar stopped naming its place the moment the chat's
// in-memory reservation went away. `null` still means a chat with no binding at
// all.
void test("\"\" is the box-root landmark, and a chat opened from the Box row is bound to i...", async (t) => {
  t.teardown(async () => {
    try {
      await cleanupSessionLogs(box.root, []);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "abc", contextDir: "" });
  await appendHistory(box.root, { sessionId: "def" });
  await seedSessionLog(box.root, "abc");

  t.check(
    {
      root: await getDirectoryForSession(box.root, "abc"),
      unbound: await getDirectoryForSession(box.root, "def"),
      lastForRoot: await getLastSessionForDirectory(box.root, ""),
    },
    {
    root: "",
    unbound: null,
    lastForRoot: "abc",
  },
  );
});

// ## sessionLogPathFor resolves an entry the caller already holds
//
// `resolveSessionLogPath` re-reads the whole history file to find the entry's
// `contextDir`. A caller looping over entries already has them, so it uses
// `sessionLogPathFor` instead — the same resolution with no per-iteration read.
// Both agree, for a bound and an unbound session.
void test("resolveSessionLogPath re-reads the whole history file to find the entry's con...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "bound", contextDir: "_content/recipes" });
  await appendHistory(box.root, { sessionId: "unbound" });
  const entries = await loadHistoryEntries(box.root);

  t.check(
    entries.map((entry) => sessionLogPathFor(box.root, entry)),
    await Promise.all(entries.map((entry) => resolveSessionLogPath(box.root, entry.id))),
  );

  // A bound entry's log lives under its context dir's encoded projects directory,
  // not the box root's:

  const [bound, unbound] = entries;
  assert.ok(bound && unbound);
  t.check(sessionLogPathFor(box.root, bound), not(sessionLogPathFor(box.root, { id: bound.id, engine: bound.engine })));

  t.check(sessionLogPathFor(box.root, unbound), getSessionLogPath(box.root, "unbound"));
});

// ## getLastSessionForDirectory returns the most recently appended match
//
// When several sessions are associated with the same directory, the
// most-recent (last appended) wins. Sessions for other directories don't
// interleave into the result.
void test("When several sessions are associated with the same directory, the most-recent...", async (t) => {
  t.teardown(async () => {
    try {
      await cleanupSessionLogs(box.root, ["_content/recipes", "_content/todos"]);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "first", contextDir: "_content/recipes" });
  await appendHistory(box.root, { sessionId: "other", contextDir: "_content/todos" });
  await appendHistory(box.root, { sessionId: "second", contextDir: "_content/recipes" });
  await appendHistory(box.root, { sessionId: "third", contextDir: "_content/recipes" });
  await seedSessionLog(box.root, "first");
  await seedSessionLog(box.root, "other");
  await seedSessionLog(box.root, "second");
  await seedSessionLog(box.root, "third");

  t.check(await getLastSessionForDirectory(box.root, "_content/recipes"), "third");

  t.check(await getLastSessionForDirectory(box.root, "_content/todos"), "other");

  t.check(await getLastSessionForDirectory(box.root, "_content/never"), null);
});

// ## getLastSessionForDirectory ignores unbound sessions
//
// Sessions in the history without a `contextDir` (e.g. plain web chats)
// don't accidentally match any directory query.
void test("Sessions in the history without a contextDir (e.g.", async (t) => {
  t.teardown(async () => {
    try {
      await cleanupSessionLogs(box.root, ["_content/recipes"]);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await appendHistory(box.root, { sessionId: "plain" });
  await appendHistory(box.root, { sessionId: "bound", contextDir: "_content/recipes" });
  await appendHistory(box.root, { sessionId: "another-plain" });
  await seedSessionLog(box.root, "plain");
  await seedSessionLog(box.root, "bound");
  await seedSessionLog(box.root, "another-plain");

  t.check(await getLastSessionForDirectory(box.root, "_content/recipes"), "bound");
});
