# Codex transcript adapter

The supported app-server representation maps user and agent messages into the
existing history view without reading Codex's private rollout file.

```ts setup
import {
  adaptCodexThreadHistory,
  assertCodexThreadCwd,
} from "../../src/core/chat/session/codex-transcript.js";
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
          { type: "fileChange", id: "file-1" },
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

Provider activity that has no current chat rendering is deliberately omitted,
while compaction remains visible:

```ts
const adapted = adaptCodexThreadHistory(response, { mode: "tail", tail: 20 });
JSON.stringify({ total: adapted.total, types: adapted.entries.map((entry) => entry.type) })
=> {"total":5,"types":["user","assistant","user","compaction","assistant"]}
```

Page slicing uses the normalized entry sequence:

```ts
JSON.stringify(adaptCodexThreadHistory(response, { mode: "page", offset: 1, limit: 2 }).entries.map((entry) => entry.uuid))
=> ["agent-1","user-2"]
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
