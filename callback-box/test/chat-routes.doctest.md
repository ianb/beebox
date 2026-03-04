# Chat Routes — Session Parsing & Utilities

Tests for the session log parsing pipeline used by chat history, plus
pure utility functions relevant to chat routes (content transformation,
tool input summarization, TTS voice validation).

```ts setup
import {
  getSessionLogPath,
  getSessionDir,
  parseSessionLog,
  transformContent,
  summarizeToolInput,
  summarizeToolResult,
} from "../src/cli/lib/session.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
```

## getSessionLogPath

Pure path computation — encodes slashes as hyphens:

```
const result = getSessionLogPath("/home/user/mybox", "abc-123");
const expected = path.join(os.homedir(), ".claude/projects/-home-user-mybox/abc-123.jsonl");
result === expected
=> true
```

## getSessionDir

```
const result = getSessionDir("/tmp/test-box");
const expected = path.join(os.homedir(), ".claude/projects/-tmp-test-box");
result === expected
=> true
```

## parseSessionLog

### Empty file

```
const box = await makeTmpBox();
await box.write("log.jsonl", "");
const result = await parseSessionLog({ logPath: box.path("log.jsonl") });
print(`entries: ${result.entries.length}`);
print(`total: ${result.total}`);
print(`hasMore: ${result.hasMore}`);
=>
entries: 0
total: 0
hasMore: false
```

``` cleanup
await box.cleanup();
```

### User and assistant entries

```
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
const result = await parseSessionLog({ logPath: box.path("log.jsonl") });
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

``` cleanup
await box.cleanup();
```

### Filters out tool-only user entries

User entries with only tool_result blocks (no real text) are skipped:

```
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
const result = await parseSessionLog({ logPath: box.path("log.jsonl") });
result.total
=> 1

result.entries[0].content[0].text
=> Real message
```

``` cleanup
await box.cleanup();
```

### Filters out non-user/assistant types

System and result entries are skipped:

```
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
const result = await parseSessionLog({ logPath: box.path("log.jsonl") });
result.total
=> 1
```

``` cleanup
await box.cleanup();
```

### Pagination

```
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
const result = await parseSessionLog({ logPath: box.path("log.jsonl"), offset: 2, limit: 2 });
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

``` cleanup
await box.cleanup();
```

## transformContent

### Text block

```
const result = transformContent([{ type: "text", text: "hello world" }]);
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: text
text: hello world
```

### String content (legacy format)

```
const result = transformContent("plain string");
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: text
text: plain string
```

### Tool use block

```
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

```
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

```
const result = transformContent([{ type: "thinking", thinking: "Let me consider..." }]);
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: thinking
text: Let me consider...
```

### Redacted thinking

```
const result = transformContent([{ type: "redacted_thinking" }]);
print(`type: ${result[0].type}`);
print(`text: ${result[0].text}`);
=>
type: thinking
text: [redacted]
```

### Empty/non-array content

```
const result = transformContent(null);
result.length
=> 0
```

## summarizeToolInput

```
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

```
summarizeToolResult("simple string")
=> simple string

summarizeToolResult(["line1", "line2"])
=>
line1
line2
```

Array with text objects:

```
summarizeToolResult([{ text: "first" }, { text: "second" }])
=>
first
second
```

Non-string/non-array returns empty:

```
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

```
resolveVoice("fable")
=> fable

resolveVoice("invalid-voice")
=> marin

resolveVoice(undefined)
=> marin

resolveVoice("")
=> marin
```
