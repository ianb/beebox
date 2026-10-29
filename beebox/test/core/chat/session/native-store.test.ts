// # The native session store table
//
// `SESSION_STORES` answers three questions about a chat's transcript where its
// engine keeps it: does it exist, when was it last written, and what is in a
// window of it. Absent is an answer (`false`, `null`), not an error. Each engine
// has one entry; pi's refuses until its store lands.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import { SESSION_STORES } from "../../../../src/core/chat/session/native-store.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { codexSessionExists } from "../../../../src/core/chat/session/codex-transcript/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SESSION = "11111111-2222-3333-4444-555555555555";
const MISSING = "99999999-8888-7777-6666-555555555555";

function line(i: number) {
  return JSON.stringify({
    type: "user",
    uuid: `u${String(i)}`,
    timestamp: `2026-01-01T00:0${String(i)}:00Z`,
    message: { role: "user", content: [{ type: "text", text: `<typed>Message ${String(i)}</typed>` }] },
  });
}

// ## Claude reads its transcript file
void test("Claude reads its transcript file", async (t) => {
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
  const logPath = getSessionLogPath(box.root, SESSION);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, `${[0, 1, 2].map(line).join("\n")}\n`);
  const written = new Date("2026-02-03T04:05:06Z");
  await utimes(logPath, written, written);
  const store = SESSION_STORES.claude;

  t.check({
    exists: await store.exists(box.root, SESSION),
    updatedAt: await store.updatedAt(box.root, SESSION),
    history: await store.readHistory(box.root, { sessionId: SESSION, slice: { mode: "page", offset: 1, limit: 1 } }),
  }, {
    exists: true,
    updatedAt: written,
    history: {
      entries: [{
        uuid: "u1",
        type: "user",
        timestamp: "2026-01-01T00:01:00Z",
        content: [{ type: "text", text: "<typed>Message 1</typed>" }],
      }],
      total: 3,
    },
  });

  // A session with no file is absent in all three answers:

  t.check({
    exists: await store.exists(box.root, MISSING),
    updatedAt: await store.updatedAt(box.root, MISSING),
    history: await store.readHistory(box.root, { sessionId: MISSING, slice: { mode: "tail", tail: 10 } }),
  }, { exists: false, updatedAt: null, history: null });
});

// ## Codex asks its app-server; pi refuses
//
// The Codex store is the existing thread readers (their own tests cover the
// RPC). pi has no store yet, and every member refuses rather than falling through
// to another engine's.
void test("Codex asks its app-server; pi refuses", async (t) => {
  t.check(SESSION_STORES.codex.exists, is(codexSessionExists));

  const pi = SESSION_STORES.pi;
  const refusal = "EngineNotImplementedError: the pi engine is not available yet";
  await t.checkThrows(() => pi.exists("/box", SESSION), `${refusal} (checking a chat transcript)`);
  await t.checkThrows(() => pi.updatedAt("/box", SESSION), `${refusal} (checking a chat transcript)`);
  await t.checkThrows(
    () => pi.readHistory("/box", { sessionId: SESSION, slice: { mode: "tail", tail: 10 } }),
    `${refusal} (reading chat history)`,
  );
});
