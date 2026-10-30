// # The native session store table
//
// `SESSION_STORES` answers three questions about a chat's transcript where its
// engine keeps it: does it exist, when was it last written, and what is in a
// window of it. Absent is an answer (`false`, `null`), not an error. Each engine
// has one entry.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import { SESSION_STORES } from "../../../../src/core/chat/session/native-store.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { codexSessionExists } from "../../../../src/core/chat/session/codex-transcript/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { piSessionsDir } from "../../../../src/core/pi-sessions.js";

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

// ## Codex asks its app-server
//
// The Codex store is the existing thread readers; their own tests cover the RPC.
void test("Codex asks its app-server", (t) => {
  t.check(SESSION_STORES.codex.exists, is(codexSessionExists));
  t.end();
});

// ## pi reads its session file under `.beebox/pi/sessions/`
//
// The lines below are the shape pi 1.4.0 writes, copied from a run against its
// `faux` provider and trimmed: a header, settings entries, the system prompt,
// then the dialogue. pi's tool call and thinking blocks sit in one assistant
// message; its tool result is a message of its own.
const piLines = [
  { type: "session", version: 3, id: SESSION, timestamp: "2026-10-29T21:33:48.061Z", cwd: "/box" },
  { type: "model_change", id: "ef30716d", parentId: null, timestamp: "2026-10-29T21:33:48.062Z", provider: "openrouter", modelId: "test/faux" },
  { type: "message", id: "31ff475a", parentId: "ef30716d", timestamp: "2026-10-29T21:33:48.065Z", message: { role: "system", content: "", sections: { preamble: "You are pi." }, timestamp: 1 } },
  { type: "message", id: "3ffea819", parentId: "31ff475a", timestamp: "2026-10-29T21:33:48.065Z", message: { role: "user", content: [{ type: "text", text: '<typed user="Alice">hello there</typed>' }], timestamp: 2 } },
  { type: "message", id: "6d23385b", parentId: "3ffea819", timestamp: "2026-10-29T21:33:48.067Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Run it." }, { type: "toolCall", id: "tool:1", name: "bash", arguments: { command: "echo hi" } }], model: "test/faux", stopReason: "toolUse", timestamp: 3 } },
  { type: "message", id: "d1463b82", parentId: "6d23385b", timestamp: "2026-10-29T21:33:48.072Z", message: { role: "toolResult", toolCallId: "tool:1", toolName: "bash", content: [{ type: "text", text: "hi\n" }], isError: false, timestamp: 4 } },
  { type: "message", id: "14ec2bf8", parentId: "d1463b82", timestamp: "2026-10-29T21:33:48.073Z", message: { role: "assistant", content: [{ type: "text", text: "All done." }], model: "test/faux", stopReason: "stop", timestamp: 5 } },
  { type: "compaction", id: "f6g7h8i9", parentId: "14ec2bf8", timestamp: "2026-10-29T21:40:00.000Z", summary: "Alice said hello.", firstKeptEntryId: "14ec2bf8", tokensBefore: 5000 },
  { type: "message", id: "a1b2c3d4", parentId: "f6g7h8i9", timestamp: "2026-10-29T21:41:00.000Z", message: { role: "user", content: "and again", timestamp: 6 } },
];

void test("pi reads its session file", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const sessionPath = join(piSessionsDir(box.root), `2026-10-29T21-33-48-061Z_${SESSION}.jsonl`);
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${piLines.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const written = new Date("2026-10-29T22:00:00Z");
  await utimes(sessionPath, written, written);
  const store = SESSION_STORES.pi;

  // The tool result rides on its call, the thinking is dropped, and the
  // compaction shows its summary. Everything that is not dialogue is skipped.

  t.check({
    exists: await store.exists(box.root, SESSION),
    updatedAt: await store.updatedAt(box.root, SESSION),
    history: await store.readHistory(box.root, { sessionId: SESSION, slice: { mode: "page", offset: 0, limit: 3 } }),
  }, {
    exists: true,
    updatedAt: written,
    history: {
      entries: [
        { uuid: "3ffea819", type: "user", timestamp: "2026-10-29T21:33:48.065Z", content: [{ type: "text", text: '<typed user="Alice">hello there</typed>' }], user: "Alice" },
        {
          uuid: "6d23385b", type: "assistant", timestamp: "2026-10-29T21:33:48.067Z",
          content: [{ type: "tool_use", toolName: "bash", toolId: "tool:1", input: { command: "echo hi" }, inputSummary: '{"command":"echo hi"}', resultSummary: "hi\n" }],
        },
        { uuid: "14ec2bf8", type: "assistant", timestamp: "2026-10-29T21:33:48.073Z", content: [{ type: "text", text: "All done." }] },
      ],
      total: 5,
    },
  });

  // A tail slice takes the newest entries; the count is still the whole session's.

  t.check(await store.readHistory(box.root, { sessionId: SESSION, slice: { mode: "tail", tail: 2 } }), {
    entries: [
      { uuid: "f6g7h8i9", type: "compaction", timestamp: "2026-10-29T21:40:00.000Z", content: [{ type: "text", text: "Alice said hello." }] },
      { uuid: "a1b2c3d4", type: "user", timestamp: "2026-10-29T21:41:00.000Z", content: [{ type: "text", text: "and again" }] },
    ],
    total: 5,
  });

  // A session pi has no file for is absent in all three answers:

  t.check({
    exists: await store.exists(box.root, MISSING),
    updatedAt: await store.updatedAt(box.root, MISSING),
    history: await store.readHistory(box.root, { sessionId: MISSING, slice: { mode: "tail", tail: 10 } }),
  }, { exists: false, updatedAt: null, history: null });

  // A file in a format version beebox does not read fails the read visibly:

  await writeFile(sessionPath, `${JSON.stringify({ ...piLines[0], version: 4 })}\n`);
  await t.checkThrows(
    () => store.readHistory(box.root, { sessionId: SESSION, slice: { mode: "tail", tail: 10 } }),
    `PiSessionVersionError: pi session ${sessionPath} has format version 4; beebox reads version 3`,
  );
});
