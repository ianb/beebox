// # Codex transcript adapter
//
// The supported app-server representation maps user and agent messages into the
// existing history view without reading Codex's private rollout file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  adaptCodexThreadHistory,
  assertCodexThreadCwd,
  codexHistoryListParams,
} from "../../../../../src/core/chat/session/codex-transcript/core.js";
import { retiredV2ContentCwds } from "../../../../../src/core/chat/session/codex-transcript/v2-cwd.js";
import { codexDisplayCommand, normalizeCodexSdkToolItem, normalizeCodexToolItem } from "../../../../../src/services/codex-tool-activity.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const response = {
  thread: {
    cwd: "/boxes/example",
    updatedAt: 200,
    turns: [
      {
        id: "turn-1",
        startedAt: 100,
        items: [
          { type: "userMessage", id: "user-1", content: [{ type: "text", text: "Hello" }] },
          { type: "commandExecution", id: "command-1", command: "bbx search hello", aggregatedOutput: "1 result", exitCode: 0 },
          { type: "fileChange", id: "file-1", status: "completed", changes: [{ path: "store/Hello.doc.card", kind: { type: "add" } }] },
          { type: "agentMessage", id: "agent-1", text: "Hi", phase: "final_answer" },
        ],
      },
      {
        id: "turn-2",
        startedAt: 200,
        items: [
          { type: "userMessage", id: "user-2", content: [{ type: "text", text: "Again" }] },
          { type: "contextCompaction", id: "compact-1" },
          { type: "agentMessage", id: "agent-2", text: "Done", phase: "final_answer" },
        ],
      },
    ],
  },
};

const T1 = "1970-01-01T00:01:40.000Z";
const T2 = "1970-01-01T00:03:20.000Z";
const text = (fields: { uuid: string; type: "user" | "assistant"; timestamp: string; body: string }) => ({
  uuid: fields.uuid, type: fields.type, timestamp: fields.timestamp, content: [{ type: "text" as const, text: fields.body }],
});
const bash = { uuid: "command-1", type: "assistant" as const, timestamp: T1, content: [{ type: "tool_use" as const, toolId: "command-1", toolName: "Bash", input: { command: "bbx search hello" }, inputSummary: "Bash" }] };
const edit = { uuid: "file-1", type: "assistant" as const, timestamp: T1, content: [{ type: "tool_use" as const, toolId: "file-1", toolName: "Edit", input: { file_path: "store/Hello.doc.card", status: "completed" }, inputSummary: "Edit" }] };
const user1 = text({ uuid: "user-1", type: "user", timestamp: T1, body: "Hello" });
const compact = { uuid: "compact-1", type: "compaction" as const, timestamp: T2, content: [] };
const agent2 = text({ uuid: "agent-2", type: "assistant", timestamp: T2, body: "Done" });

// Provider activity is normalized into the same tool-call blocks the existing chat
// UI renders for Claude, while compaction remains visible:
void test("Provider activity is normalized into the same tool-call blocks the existing c...", async (t) => {
  // doctest:L51
  const adapted = adaptCodexThreadHistory(response, { mode: "tail", tail: 20 });
  t.check(adapted, {
    entries: [user1, bash, edit, text({ uuid: "agent-1", type: "assistant", timestamp: T1, body: "Hi" }), text({ uuid: "user-2", type: "user", timestamp: T2, body: "Again" }), compact, agent2],
    total: 7,
  });
});

// Page slicing uses the normalized entry sequence:
void test("Page slicing uses the normalized entry sequence:", async (t) => {
  // doctest:L65
  t.check(adaptCodexThreadHistory(response, { mode: "page", offset: 1, limit: 2 }), { entries: [bash, edit], total: 7 });
});

// A tail slice returns the newest entries, a page from offset 0 the oldest. The
// at-most-once delivery probe (`userMessageAlreadyLanded`) looks for a message
// sent just before a crash, so it reads the tail: on a thread longer than its
// cap, a page from 0 would never reach that message.
void test("A tail slice returns the newest entries, a page from offset 0 the oldest.", async (t) => {
  // doctest:L75
  t.check(adaptCodexThreadHistory(response, { mode: "tail", tail: 2 }), { entries: [compact, agent2], total: 7 });

  // doctest:L78
  t.check(adaptCodexThreadHistory(response, { mode: "page", offset: 0, limit: 2 }), { entries: [user1, bash], total: 7 });
});

// The same provider adapter feeds live chat. It gives every supported Codex
// activity a stable tool name and keeps large file diffs and search results out of
// the UI payload:
void test("The same provider adapter feeds live chat.", async (t) => {
  // doctest:L87
  t.check(
    [
      normalizeCodexToolItem({ type: "commandExecution", id: "c", command: "bbx status" }),
      normalizeCodexToolItem({ type: "fileChange", id: "f", status: "completed", changes: [{ path: "store/A.card", diff: "large" }] }),
      normalizeCodexToolItem({ type: "webSearch", id: "w", query: "Bee Box" }),
      normalizeCodexToolItem({ type: "mcpToolCall", id: "m", server: "calendar", tool: "list", arguments: '{"days":7}' }),
      normalizeCodexToolItem({ type: "subAgentActivity", id: "a", kind: "started", agentPath: "/root/review", agentThreadId: "thread-1" }),
      normalizeCodexToolItem({ type: "collab_tool_call", id: "c", tool: "wait", receiver_thread_ids: [], status: "completed" }),
    ],
    [
      { type: "tool_use", id: "c", name: "Bash", input: { command: "bbx status" } },
      { type: "tool_use", id: "f", name: "Edit", input: { file_path: "store/A.card", status: "completed" } },
      { type: "tool_use", id: "w", name: "WebSearch", input: { query: "Bee Box" } },
      { type: "tool_use", id: "m", name: "calendar.list", input: { days: 7 } },
      { type: "tool_use", id: "a", name: "Agent", input: { description: "/root/review", kind: "started", thread_id: "thread-1" } },
      { type: "tool_use", id: "c", name: "Agent", input: { action: "wait", status: "completed", thread_ids: [] } },
    ],
  );
});

// Codex reports a command as the shell invocation it ran. Both entry points show
// the command inside a `bash -lc` wrapper, as Claude's activity does:
void test("Codex reports a command as the shell invocation it ran.", async (t) => {
  // doctest:L102
  t.check(normalizeCodexToolItem({ type: "commandExecution", id: "c", command: "/bin/bash -lc 'cat AGENTS.md'" }), { type: "tool_use", id: "c", name: "Bash", input: { command: "cat AGENTS.md" } });
});

// Codex double-quotes an argument that holds a single quote:
void test("Codex double-quotes an argument that holds a single quote:", async (t) => {
  // doctest:L109
  t.check(codexDisplayCommand("/opt/homebrew/bin/bash -lc \"sed -n '1,80p' box-docs/card-image.md && rg -n EXIF box-docs\""), "sed -n '1,80p' box-docs/card-image.md && rg -n EXIF box-docs");
});

// Anything else shows verbatim: a double-quoted argument with escapes or
// expansions, a different shell, or a command with no wrapper.
void test("Anything else shows verbatim:", async (t) => {
  // doctest:L117
  t.check(
    [
      codexDisplayCommand("/bin/bash -lc \"echo \\\"$HOME\\\"\""),
      codexDisplayCommand("/bin/zsh -lc 'ls'"),
      codexDisplayCommand("/bin/bash -lc 'a' && rm 'b'"),
      codexDisplayCommand("bbx status"),
    ],
    [
    "/bin/bash -lc \"echo \\\"$HOME\\\"\"",
    "/bin/zsh -lc 'ls'",
    "/bin/bash -lc 'a' && rm 'b'",
    "bbx status",
  ],
  );
});

// The live SDK vocabulary maps through a separate typed entry point while native
// history retains its app-server vocabulary:
void test("The live SDK vocabulary maps through a separate typed entry point while nativ...", async (t) => {
  // doctest:L135
  t.check(
    normalizeCodexSdkToolItem({
      id: "mcp-1",
      type: "mcp_tool_call",
      status: "completed",
      server: "drive",
      tool: "find",
      arguments: {},
      result: { content: [], structured_content: {} },
    }),
    { type: "tool_use", id: "mcp-1", name: "drive.find", input: {} },
  );
});

// SDK threads are created by `codex exec`. The history app-server defaults to
// interactive sources, so listing must opt into both SDK and legacy execution
// sources. A listing reads the thread index alone; only a repair listing
// permits the JSONL metadata scan, which reads every session on the host.
void test("SDK threads are created by codex exec.", async (t) => {
  // doctest:L153
  t.check(codexHistoryListParams({ cwds: ["/boxes/example"], cursor: "next", repair: false }), {
    cursor: "next",
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    cwd: [
      "/boxes/example",
    ],
    sourceKinds: [
      "cli",
      "vscode",
      "exec",
      "appServer",
    ],
    useStateDbOnly: true,
  });
});

// A repair listing is the same request with the scan allowed:
void test("A repair listing is the same request with the scan allowed:", async (t) => {
  // doctest:L160
  t.check(codexHistoryListParams({ cwds: ["/boxes/example"], cursor: null, repair: true }), {
    cursor: null,
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    cwd: ["/boxes/example"],
    sourceKinds: ["cli", "vscode", "exec", "appServer"],
    useStateDbOnly: false,
  });
});

// User identity carried by beebox's message wrapper is normalized just as
// it is for Claude transcripts. The UI uses the email to recognize the signed-in
// person; comparing the display name to that email would falsely render the
// message as another participant.
void test("User identity carried by beebox's message wrapper is normalized just as it is...", async (t) => {
  // doctest:L170
  const attributed = adaptCodexThreadHistory({
    thread: {
      cwd: "/boxes/example",
      updatedAt: 300,
      turns: [{
        id: "turn-attributed",
        startedAt: 300,
        items: [{
          type: "userMessage",
          id: "user-attributed",
          content: [{
            type: "text",
            text: '<typed user="Ian Bicking" user-email="ian@example.com">Hello</typed>',
          }],
        }],
      }],
    },
  }, { mode: "tail", tail: 20 });
  t.check(attributed, {
    entries: [{
      uuid: "user-attributed",
      type: "user",
      timestamp: "1970-01-01T00:05:00.000Z",
      content: [{ type: "text", text: '<typed user="Ian Bicking" user-email="ian@example.com">Hello</typed>' }],
      user: "Ian Bicking",
      userEmail: "ian@example.com",
    }],
    total: 1,
  });
});

// `thread/read` accepts any known ID, so the adapter rejects a thread whose working
// directory is outside the current box. Landmark subdirectories remain valid.
void test("thread/read accepts any known ID, so the adapter rejects a thread whose worki...", async (t) => {
  t.teardown(async () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L196
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cwd-"));
  const boxRoot = path.join(root, "box");
  const landmark = path.join(boxRoot, "store", "recipes");
  const outside = path.join(root, "outside");
  fs.mkdirSync(landmark, { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(boxRoot, "outside-link"));

  // doctest:L204
  t.check(assertCodexThreadCwd(boxRoot, landmark), undefined);

  // doctest:L207
  await t.checkThrows(async () => (assertCodexThreadCwd(boxRoot, outside)), "CodexSessionOutsideBoxError: Codex session belongs to a working directory outside this box");

  // doctest:L210
  await t.checkThrows(async () => (assertCodexThreadCwd(boxRoot, path.join(boxRoot, "outside-link"))), "CodexSessionOutsideBoxError: Codex session belongs to a working directory outside this box");
});

// ## Finding 4 (round 5 hardening): a retired v2 `content/` cwd still resolves post-migration
//
// A Codex thread recorded before a box ran the one-root migration carries a
// `cwd` under the retired v2 operational root — Codex's own session storage is
// external to the box, so that `cwd` is frozen exactly as recorded. Once
// `content/` is gone, a plain `realpathSync` would throw ENOENT and strand the
// thread. `assertCodexThreadCwd` translates a missing `<boxRoot>/content[/…]`
// cwd through the same v2 → v3 mapping the migration itself used before
// re-checking: the content root itself maps to the box root, and a nested
// `content/<sub>` maps to wherever `<sub>` actually landed.
void test("A Codex thread recorded before a box ran the one-root migration carries a cwd...", async (t) => {
  t.teardown(async () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L230
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-v2-cwd-"));
  const boxRoot = path.join(root, "box");
  // The v3 area `store/recipes` (v2) maps to — no `content/` directory at all,
  // since it was removed by the migration.
  fs.mkdirSync(path.join(boxRoot, "_content", "recipes"), { recursive: true });

  // doctest:L236
  t.check(assertCodexThreadCwd(boxRoot, path.join(boxRoot, "content")), undefined);

  // doctest:L239
  t.check(assertCodexThreadCwd(boxRoot, path.join(boxRoot, "content", "store", "recipes")), undefined);

  // A `content/`-shaped path `mapV2Path` doesn't recognize still fails closed —
  // this fallback only covers what the migration itself knew how to move, so it's
  // left to fail on the original ENOENT rather than being waved through:

  // doctest:L248
  const err = (() => { try { assertCodexThreadCwd(boxRoot, path.join(boxRoot, "content", "nonexistent-nonsense")); return null; } catch (e) { return e; } })();
  const missing = path.join(fs.realpathSync(root), "box", "_content", "nonexistent-nonsense");
  t.check(err, {
    name: "Error",
    message: `ENOENT: no such file or directory, lstat '${missing}'`,
    errno: -2,
    code: "ENOENT",
    syscall: "lstat",
    path: missing,
  });
});

// ## Listing asks for the retired v2 cwds too
//
// Reading one thread translates its old cwd forward (above). Listing has the
// opposite problem: Codex filters `thread/list` on the exact cwd it recorded,
// so a chat started before the migration lists only under its v2 path, and
// its husk used to read as dead although its rollout was intact. The listing
// therefore asks for each v3 cwd's v2 aliases as well. The box root's alias is
// the v2 `content/` root, and a cwd outside the box has none.
void test("Reading one thread translates its old cwd forward (above).", async (t) => {
  // doctest:L267
  t.check({
    root: retiredV2ContentCwds("/boxes/b", "/boxes/b"),
    recipes: retiredV2ContentCwds("/boxes/b", "/boxes/b/_content/recipes"),
    outside: retiredV2ContentCwds("/boxes/b", "/boxes/other/_content/recipes"),
  }, {
    root: ["/boxes/b/content"],
    recipes: ["/boxes/b/content/recipes", "/boxes/b/content/store/recipes"],
    outside: [],
  });
});
