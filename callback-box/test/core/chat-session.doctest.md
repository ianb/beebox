# ChatSession

Tests for the `ChatSession` class: session ID persistence, state accessors,
reset, and history loading. These tests don't spawn a real Claude process.

```ts setup
import { ChatSession, buildContentBlocks } from "../../src/core/chat/session/index.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## Constructor — no saved session

A new ChatSession on an empty box has no session and is idle:

```ts
const box = await makeTmpBox();
const session = new ChatSession(box.root);
print(`sessionId: ${session.getSessionId()}`);
print(`running: ${session.isRunning()}`);
print(`busy: ${session.isBusy()}`);
=>
sessionId: null
running: false
busy: false
```

```ts cleanup
await box.cleanup();
```

## Session ID persistence — save then load

Writing a session file before constructing ChatSession loads it:

```ts
const box = await makeTmpBox();
const dir = path.join(box.root, ".callback-box");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(
  path.join(dir, "chat-session-id.json"),
  JSON.stringify({ sessionId: "test-abc-123", savedAt: "2026-01-01T00:00:00Z" })
);
const session = new ChatSession(box.root);
session.getSessionId()
=> test-abc-123
```

```ts cleanup
await box.cleanup();
```

## Session ID persistence — corrupt file

Invalid JSON in the session file is handled gracefully:

```ts
const box = await makeTmpBox();
const dir = path.join(box.root, ".callback-box");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, "chat-session-id.json"), "not json{{{");
const session = new ChatSession(box.root);
session.getSessionId()
=> null
```

```ts cleanup
await box.cleanup();
```

## resetSession — clears file and state

Reset deletes the session file and clears the in-memory session ID:

```ts
const box = await makeTmpBox();
const dir = path.join(box.root, ".callback-box");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(
  path.join(dir, "chat-session-id.json"),
  JSON.stringify({ sessionId: "to-reset" })
);
const session = new ChatSession(box.root);
session.getSessionId()
=> to-reset

session.resetSession();
session.getSessionId()
=> null

const exists = await fs.access(path.join(dir, "chat-session-id.json")).then(() => true, () => false);
exists
=> false
```

```ts cleanup
await box.cleanup();
```

## resetSession — no file to delete

Reset on a session with no file doesn't throw:

```ts
const box = await makeTmpBox();
const session = new ChatSession(box.root);
session.resetSession();
session.getSessionId()
=> null
```

```ts cleanup
await box.cleanup();
```

## getHistory — no session

With no session ID, getHistory returns empty:

```ts
const box = await makeTmpBox();
const session = new ChatSession(box.root);
const history = await session.getHistory();
print(`sessionId: ${history.sessionId}`);
print(`entries: ${history.entries.length}`);
=>
sessionId: null
entries: 0
```

```ts cleanup
await box.cleanup();
```

## getHistory — session but no log file

With a session ID but no actual log file on disk, returns empty entries:

```ts
const box = await makeTmpBox();
const dir = path.join(box.root, ".callback-box");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(
  path.join(dir, "chat-session-id.json"),
  JSON.stringify({ sessionId: "orphan-session" })
);
const session = new ChatSession(box.root);
const history = await session.getHistory();
print(`sessionId: ${history.sessionId}`);
print(`entries: ${history.entries.length}`);
=>
sessionId: orphan-session
entries: 0
```

```ts cleanup
await box.cleanup();
```

## buildContentBlocks — text only (no images)

With no images, the helper returns a single text block unchanged:

```ts
JSON.stringify(buildContentBlocks({ text: "hello world" }))
=> [{"type":"text","text":"hello world"}]
```

## buildContentBlocks — inline image replacement

An `[imageN]` token in the text is replaced with the matching image block,
and the surrounding text is split into separate blocks:

```ts
const imgs = [{ id: 1, mimeType: "image/png", dataBase64: "AAAA" }];
const blocks = buildContentBlocks({ text: "before [image1] after", images: imgs });
JSON.stringify(blocks)
=> [{"type":"text","text":"before "},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}},{"type":"text","text":" after"}]
```

## buildContentBlocks — unreferenced images append at end

Images without a matching `[imageN]` token get appended after the text:

```ts
const imgs = [{ id: 1, mimeType: "image/jpeg", dataBase64: "QQ==" }];
const blocks = buildContentBlocks({ text: "no token here", images: imgs });
JSON.stringify(blocks.map((b) => b.type))
=> ["text","image"]
```

## buildContentBlocks — orphan tokens left as literal text

A `[image9]` token with no matching attachment stays as literal text
(rather than being silently dropped):

```ts
const imgs = [{ id: 1, mimeType: "image/png", dataBase64: "X" }];
const blocks = buildContentBlocks({ text: "[image9] is orphan [image1] real", images: imgs });
JSON.stringify(blocks)
=> [{"type":"text","text":"[image9] is orphan "},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"X"}},{"type":"text","text":" real"}]
```

## buildContentBlocks — multiple images in order

Two different images resolve to different blocks at their respective
token positions:

```ts
const imgs = [
  { id: 1, mimeType: "image/png", dataBase64: "ONE" },
  { id: 2, mimeType: "image/png", dataBase64: "TWO" },
];
const blocks = buildContentBlocks({ text: "dog [image2] cat [image1]", images: imgs });
JSON.stringify(blocks.map((b) => b.type === "image" ? b.source?.data : b.text))
=> ["dog ","TWO"," cat ","ONE"]
```
