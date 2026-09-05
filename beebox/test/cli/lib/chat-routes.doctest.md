# Chat Routes — Session Parsing & Utilities

Tests for the session log parsing pipeline used by chat history, plus
pure utility functions relevant to chat routes (content transformation,
tool input summarization, TTS voice validation).

```ts setup
import {
  parseSessionLog,
  transformContent,
  summarizeToolInput,
  summarizeToolResult,
} from "../../../src/cli/lib/session.js";
import {
  getSessionLogPath,
  getSessionDir,
  containedSessionCwd,
} from "../../../src/core/chat/session/transcript-paths.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
// "Everything, bounded": the first page at the hard retention ceiling. Every
// parseSessionLog call names a slice — there is no unbounded shape.
const ALL = { mode: "page", offset: 0, limit: 5000 };
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
```

## getSessionLogPath

Pure path computation — encodes slashes as hyphens:

```ts
const result = getSessionLogPath("/home/user/mybox", "abc-123");
const expected = path.join(os.homedir(), ".claude/projects/-home-user-mybox/abc-123.jsonl");
result === expected
=> true
```

## getSessionDir

```ts
const result = getSessionDir("/tmp/test-box");
const expected = path.join(os.homedir(), ".claude/projects/-tmp-test-box");
result === expected
=> true
```

## containedSessionCwd

A landmark-bound chat runs the SDK with its cwd set to a box subdirectory, and
that `contextDir` is a string read off the box's session-history file. It gets
joined into a filesystem path — now on behalf of an HTTP request, since
`/api/session-media` serves a photo out of whichever transcript this resolves
to. An ordinary binding resolves as you would expect:

```ts
containedSessionCwd("/tmp/test-box", "_content/recipes") === path.join("/tmp/test-box", "_content/recipes")
=> true
```

No binding is the box root:

```ts
JSON.stringify([containedSessionCwd("/tmp/test-box", undefined), containedSessionCwd("/tmp/test-box", "")])
=> ["/tmp/test-box","/tmp/test-box"]
```

A row that climbs out of the box does **not** get clamped into something
plausible — it falls back to the box root, so the transcript it names is simply
not found rather than read from somewhere else:

```ts
containedSessionCwd("/tmp/test-box", "../../etc")
=> /tmp/test-box
```

A leading slash does not make it absolute — `path.join` reads it as
box-relative, so it lands inside the box rather than at the filesystem root:

```ts
containedSessionCwd("/tmp/test-box", "/etc/passwd")
=> /tmp/test-box/etc/passwd
```

## parseSessionLog

### Empty file

```ts
const box = await makeTmpBox();
await box.write("log.jsonl", "");
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
print(`entries: ${result.entries.length}`);
print(`total: ${result.total}`);
print(`hasMore: ${result.hasMore}`);
=>
entries: 0
total: 0
hasMore: false
```

```ts cleanup
await box.cleanup();
```

### User and assistant entries

```ts
const box = await makeTmpBox();
const lines = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "Hello" }] },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
  }),
].join("\n");
await box.write("log.jsonl", lines);
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
print(`total: ${result.total}`);
print(`e0 type: ${result.entries[0].type}`);
print(`e0 text: ${result.entries[0].content[0].text}`);
print(`e1 type: ${result.entries[1].type}`);
print(`e1 text: ${result.entries[1].content[0].text}`);
=>
total: 2
e0 type: user
e0 text: Hello
e1 type: assistant
e1 text: Hi there!
```

```ts cleanup
await box.cleanup();
```

### Filters out tool-only user entries

User entries with only tool_result blocks (no real text) are skipped:

```ts
const box = await makeTmpBox();
const lines = [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "u2",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "user", content: [{ type: "text", text: "Real message" }] },
  }),
].join("\n");
await box.write("log.jsonl", lines);
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
result.total
=> 1

result.entries[0].content[0].text
=> Real message
```

```ts cleanup
await box.cleanup();
```

### Filters out non-user/assistant types

System and result entries are skipped:

```ts
const box = await makeTmpBox();
const lines = [
  JSON.stringify({ type: "system", uuid: "s1", message: { content: "init" } }),
  JSON.stringify({ type: "result", uuid: "r1", result: "done" }),
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "Only real one" }] },
  }),
].join("\n");
await box.write("log.jsonl", lines);
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
result.total
=> 1
```

```ts cleanup
await box.cleanup();
```

### Pagination

```ts
const box = await makeTmpBox();
const lines = [];
for (let i = 0; i < 5; i++) {
  lines.push(JSON.stringify({
    type: "user",
    uuid: `u${i}`,
    timestamp: `2026-01-01T00:0${i}:00Z`,
    message: { role: "user", content: [{ type: "text", text: `Message ${i}` }] },
  }));
}
await box.write("log.jsonl", lines.join("\n"));
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: { mode: "page", offset: 2, limit: 2 } });
print(`entries: ${result.entries.length}`);
print(`total: ${result.total}`);
print(`hasMore: ${result.hasMore}`);
print(`first: ${result.entries[0].content[0].text}`);
=>
entries: 2
total: 5
hasMore: true
first: Message 2
```

```ts cleanup
await box.cleanup();
```

## transformContent

### Text block

```ts
const result = transformContent([{ type: "text", text: "hello world" }]);
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: text
text: hello world
```

### String content (legacy format)

```ts
const result = transformContent("plain string");
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: text
text: plain string
```

### Tool use block

```ts
const result = transformContent([{
  type: "tool_use",
  name: "Read",
  id: "tool_1",
  input: { file_path: "/tmp/test.ts" },
}]);
print(`type: ${result[0].type}`);
print(`toolName: ${result[0].toolName}`);
print(`toolId: ${result[0].toolId}`);
print(`inputSummary: ${result[0].inputSummary}`);
=>
type: tool_use
toolName: Read
toolId: tool_1
inputSummary: /tmp/test.ts
```

### Tool result block

```ts
const result = transformContent([{
  type: "tool_result",
  tool_use_id: "tool_1",
  content: "file contents here",
}]);
print(`type: ${result[0].type}`);
print(`toolUseId: ${result[0].toolUseId}`);
print(`resultSummary: ${result[0].resultSummary}`);
=>
type: tool_result
toolUseId: tool_1
resultSummary: file contents here
```

### Thinking block

```ts
const result = transformContent([{ type: "thinking", thinking: "Let me consider..." }]);
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: thinking
text: Let me consider...
```

### Redacted thinking

```ts
const result = transformContent([{ type: "redacted_thinking" }]);
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: thinking
text: [redacted]
```

### Empty/non-array content

```ts
const result = transformContent(null);
result.length
=> 0
```

### Image block (base64)

User-pasted images arrive as image content blocks with a base64 source.
They're preserved so the chat UI can render them inline.

```ts
const result = transformContent([
  { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
]);
JSON.stringify(result[0])
=> {"type":"image","mediaType":"image/png","dataBase64":"AAAA"}
```

### Image block (url)

Image blocks using a URL source are preserved as `imageUrl`:

```ts
const result = transformContent([
  { type: "image", source: { type: "url", url: "https://example.com/x.png" } }
]);
JSON.stringify(result[0])
=> {"type":"image","imageUrl":"https://example.com/x.png"}
```

### User turn with only images is dropped as plumbing

Claude Code emits user-role turns containing only image blocks when
feeding PDF pages to the model. `parseSessionLog` treats these as
plumbing and filters them out (the surrounding user prose, if any,
is what carries the real message).

```ts
const { writeFile } = await import("node:fs/promises");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const dir = mkdtempSync(join(tmpdir(), "chat-img-"));
const logPath = join(dir, "session.jsonl");
const lines = [
  // Synthetic PDF-page plumbing: user turn with only an image block
  { type: "user", uuid: "u1", timestamp: "t1", message: { role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "PDFPAGE" } }
  ] } },
  // Real user paste: text + image
  { type: "user", uuid: "u2", timestamp: "t2", message: { role: "user", content: [
    { type: "text", text: "<typed>look</typed>" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "PASTED" } }
  ] } },
];
await writeFile(logPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
const result = await parseSessionLog({ logPath, slice: ALL });
print(`entries: ${result.entries.length}`);
print(`uuid: ${result.entries[0].uuid}`);
print(`blocks: ${result.entries[0].content.map((b) => b.type).join(",")}`);
=>
entries: 1
uuid: u2
blocks: text,image
```

## summarizeToolInput

```ts
summarizeToolInput("Read", { file_path: "/src/main.ts" })
=> /src/main.ts

summarizeToolInput("Edit", { file_path: "/src/utils.ts" })
=> /src/utils.ts

summarizeToolInput("Bash", { description: "Run tests", command: "npm test" })
=> Run tests

summarizeToolInput("Glob", { pattern: "**/*.ts" })
=> **/*.ts

summarizeToolInput("Grep", { pattern: "TODO", path: "src/" })
=> TODO in src/

summarizeToolInput("TodoWrite", { todos: [] })
=> update todos

summarizeToolInput("Write", { file_path: "/tmp/out.txt", content: "hello world" })
=> /tmp/out.txt (11 chars)
```

## summarizeToolResult

```ts
summarizeToolResult("simple string")
=> simple string

summarizeToolResult(["line1", "line2"])
=>
line1
line2
```

Array with text objects:

```ts
summarizeToolResult([{ text: "first" }, { text: "second" }])
=>
first
second
```

Non-string/non-array returns empty:

```ts
summarizeToolResult(42)
=>
```

## TTS voice validation

Reproducing the inline logic from chat.ts route:

```ts setup
const VALID_TTS_VOICES = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse",
];

function resolveVoice(voice) {
  return voice && VALID_TTS_VOICES.includes(voice) ? voice : "marin";
}
```

```ts
resolveVoice("fable")
=> fable

resolveVoice("invalid-voice")
=> marin

resolveVoice(undefined)
=> marin

resolveVoice("")
=> marin
```
