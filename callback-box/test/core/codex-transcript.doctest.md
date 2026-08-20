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
          { type: "commandExecution", id: "command-1", command: "cb search hello", aggregatedOutput: "1 result", exitCode: 0 },
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

The same provider adapter feeds live chat. It gives every supported Codex
activity a stable tool name and keeps large file diffs and search results out of
the UI payload:

```ts
JSON.stringify([
  normalizeCodexToolItem({ type: "commandExecution", id: "c", command: "cb status" }),
  normalizeCodexToolItem({ type: "fileChange", id: "f", status: "completed", changes: [{ path: "store/A.card", diff: "large" }] }),
  normalizeCodexToolItem({ type: "webSearch", id: "w", query: "callback box" }),
  normalizeCodexToolItem({ type: "mcpToolCall", id: "m", server: "calendar", tool: "list", arguments: '{"days":7}' }),
  normalizeCodexToolItem({ type: "subAgentActivity", id: "a", kind: "started", agentPath: "/root/review", agentThreadId: "thread-1" }),
].map((block) => ({ name: block?.name, input: block?.input })))
=> [{"name":"Bash","input":{"command":"cb status"}},{"name":"Edit","input":{"file_path":"store/A.card","status":"completed"}},{"name":"WebSearch","input":{"query":"callback box"}},{"name":"calendar.list","input":{"days":7}},{"name":"Agent","input":{"description":"/root/review","kind":"started","thread_id":"thread-1"}}]
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

User identity carried by callback-box's message wrapper is normalized just as
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
