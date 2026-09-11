# Codex transcript adapter

The supported app-server representation maps user and agent messages into the
existing history view without reading Codex's private rollout file.

```ts setup
import {
  adaptCodexThreadHistory,
  assertCodexThreadCwd,
  codexHistoryListParams,
} from "../../src/core/chat/session/codex-transcript.js";
import { normalizeCodexSdkToolItem, normalizeCodexToolItem } from "../../src/services/codex-tool-activity.js";
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
          { type: "fileChange", id: "file-1", status: "completed", changes: [{ path: "store/Hello.memo.card", kind: { type: "add" } }] },
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
```

Provider activity is normalized into the same tool-call blocks the existing chat
UI renders for Claude, while compaction remains visible:

```ts
const adapted = adaptCodexThreadHistory(response, { mode: "tail", tail: 20 });
JSON.stringify({
  total: adapted.total,
  entries: adapted.entries.map((entry) => ({
    type: entry.type,
    tools: entry.content.filter((block) => block.type === "tool_use").map((block) => block.toolName),
  })),
})
=> {"total":7,"entries":[{"type":"user","tools":[]},{"type":"assistant","tools":["Bash"]},{"type":"assistant","tools":["Edit"]},{"type":"assistant","tools":[]},{"type":"user","tools":[]},{"type":"compaction","tools":[]},{"type":"assistant","tools":[]}]}
```

Page slicing uses the normalized entry sequence:

```ts
JSON.stringify(adaptCodexThreadHistory(response, { mode: "page", offset: 1, limit: 2 }).entries.map((entry) => entry.uuid))
=> ["command-1","file-1"]
```

A tail slice returns the newest entries, a page from offset 0 the oldest. The
at-most-once delivery probe (`userMessageAlreadyLanded`) looks for a message
sent just before a crash, so it reads the tail: on a thread longer than its
cap, a page from 0 would never reach that message.

```ts
JSON.stringify(adaptCodexThreadHistory(response, { mode: "tail", tail: 2 }).entries.map((entry) => entry.uuid))
=> ["compact-1","agent-2"]

JSON.stringify(adaptCodexThreadHistory(response, { mode: "page", offset: 0, limit: 2 }).entries.map((entry) => entry.uuid))
=> ["user-1","command-1"]
```

The same provider adapter feeds live chat. It gives every supported Codex
activity a stable tool name and keeps large file diffs and search results out of
the UI payload:

```ts
JSON.stringify([
  normalizeCodexToolItem({ type: "commandExecution", id: "c", command: "bbx status" }),
  normalizeCodexToolItem({ type: "fileChange", id: "f", status: "completed", changes: [{ path: "store/A.card", diff: "large" }] }),
  normalizeCodexToolItem({ type: "webSearch", id: "w", query: "Bee Box" }),
  normalizeCodexToolItem({ type: "mcpToolCall", id: "m", server: "calendar", tool: "list", arguments: '{"days":7}' }),
  normalizeCodexToolItem({ type: "subAgentActivity", id: "a", kind: "started", agentPath: "/root/review", agentThreadId: "thread-1" }),
  normalizeCodexToolItem({ type: "collab_tool_call", id: "c", tool: "wait", receiver_thread_ids: [], status: "completed" }),
].map((block) => ({ name: block?.name, input: block?.input })))
=> [{"name":"Bash","input":{"command":"bbx status"}},{"name":"Edit","input":{"file_path":"store/A.card","status":"completed"}},{"name":"WebSearch","input":{"query":"Bee Box"}},{"name":"calendar.list","input":{"days":7}},{"name":"Agent","input":{"description":"/root/review","kind":"started","thread_id":"thread-1"}},{"name":"Agent","input":{"action":"wait","status":"completed","thread_ids":[]}}]
```

The live SDK vocabulary maps through a separate typed entry point while native
history retains its app-server vocabulary:

```ts
normalizeCodexSdkToolItem({
  id: "mcp-1",
  type: "mcp_tool_call",
  status: "completed",
  server: "drive",
  tool: "find",
  arguments: {},
  result: { content: [], structured_content: {} },
})?.name
=> drive.find
```

SDK threads are created by `codex exec`. The history app-server defaults to
interactive sources, so listing must opt into both SDK and legacy execution
sources and permit its JSONL metadata repair scan.

```ts
JSON.stringify(codexHistoryListParams(["/boxes/example"], "next"))
=> {"cursor":"next","limit":100,"sortKey":"updated_at","sortDirection":"desc","cwd":["/boxes/example"],"sourceKinds":["cli","vscode","exec","appServer"],"useStateDbOnly":false}
```

User identity carried by beebox's message wrapper is normalized just as
it is for Claude transcripts. The UI uses the email to recognize the signed-in
person; comparing the display name to that email would falsely render the
message as another participant.

```ts
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
JSON.stringify({ user: attributed.entries[0]?.user, userEmail: attributed.entries[0]?.userEmail })
=> {"user":"Ian Bicking","userEmail":"ian@example.com"}
```

`thread/read` accepts any known ID, so the adapter rejects a thread whose working
directory is outside the current box. Landmark subdirectories remain valid.

```ts
const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cwd-"));
const boxRoot = path.join(root, "box");
const landmark = path.join(boxRoot, "store", "recipes");
const outside = path.join(root, "outside");
fs.mkdirSync(landmark, { recursive: true });
fs.mkdirSync(outside);
fs.symlinkSync(outside, path.join(boxRoot, "outside-link"));

assertCodexThreadCwd(boxRoot, landmark)
=> undefined

assertCodexThreadCwd(boxRoot, outside)
=> throws CodexSessionOutsideBoxError: Codex session belongs to a working directory outside this box

assertCodexThreadCwd(boxRoot, path.join(boxRoot, "outside-link"))
=> throws CodexSessionOutsideBoxError: Codex session belongs to a working directory outside this box
```

```ts cleanup
fs.rmSync(root, { recursive: true, force: true });
```

## Finding 4 (round 5 hardening): a retired v2 `content/` cwd still resolves post-migration

A Codex thread recorded before a box ran the one-root migration carries a
`cwd` under the retired v2 operational root — Codex's own session storage is
external to the box, so that `cwd` is frozen exactly as recorded. Once
`content/` is gone, a plain `realpathSync` would throw ENOENT and strand the
thread. `assertCodexThreadCwd` translates a missing `<boxRoot>/content[/…]`
cwd through the same v2 → v3 mapping the migration itself used before
re-checking: the content root itself maps to the box root, and a nested
`content/<sub>` maps to wherever `<sub>` actually landed.

```ts
const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-v2-cwd-"));
const boxRoot = path.join(root, "box");
// The v3 area `store/recipes` (v2) maps to — no `content/` directory at all,
// since it was removed by the migration.
fs.mkdirSync(path.join(boxRoot, "_content", "recipes"), { recursive: true });

assertCodexThreadCwd(boxRoot, path.join(boxRoot, "content"))
=> undefined

assertCodexThreadCwd(boxRoot, path.join(boxRoot, "content", "store", "recipes"))
=> undefined
```

A `content/`-shaped path `mapV2Path` doesn't recognize still fails closed —
this fallback only covers what the migration itself knew how to move, so it's
left to fail on the original ENOENT rather than being waved through:

```ts continue
const err = (() => { try { assertCodexThreadCwd(boxRoot, path.join(boxRoot, "content", "nonexistent-nonsense")); return null; } catch (e) { return e; } })();
JSON.stringify({ isCodexSessionOutsideBoxError: err instanceof Error && err.name === "CodexSessionOutsideBoxError", code: err.code })
=> {"isCodexSessionOutsideBoxError":false,"code":"ENOENT"}
```

```ts cleanup
fs.rmSync(root, { recursive: true, force: true });
```
