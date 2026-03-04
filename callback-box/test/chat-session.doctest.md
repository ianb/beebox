# ChatSession

Tests for the `ChatSession` class: session ID persistence, state accessors,
reset, and history loading. These tests don't spawn a real Claude process.

```ts setup
import { ChatSession } from "../src/core/chat-session.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## Constructor — no saved session

A new ChatSession on an empty box has no session and is idle:

```
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

``` cleanup
await box.cleanup();
```

## Session ID persistence — save then load

Writing a session file before constructing ChatSession loads it:

```
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

``` cleanup
await box.cleanup();
```

## Session ID persistence — corrupt file

Invalid JSON in the session file is handled gracefully:

```
const box = await makeTmpBox();
const dir = path.join(box.root, ".callback-box");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, "chat-session-id.json"), "not json{{{");
const session = new ChatSession(box.root);
session.getSessionId()
=> null
```

``` cleanup
await box.cleanup();
```

## resetSession — clears file and state

Reset deletes the session file and clears the in-memory session ID:

```
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

``` cleanup
await box.cleanup();
```

## resetSession — no file to delete

Reset on a session with no file doesn't throw:

```
const box = await makeTmpBox();
const session = new ChatSession(box.root);
session.resetSession();
session.getSessionId()
=> null
```

``` cleanup
await box.cleanup();
```

## getHistory — no session

With no session ID, getHistory returns empty:

```
const box = await makeTmpBox();
const session = new ChatSession(box.root);
const history = await session.getHistory();
print(`sessionId: ${history.sessionId}`);
print(`entries: ${history.entries.length}`);
=>
sessionId: null
entries: 0
```

``` cleanup
await box.cleanup();
```

## getHistory — session but no log file

With a session ID but no actual log file on disk, returns empty entries:

```
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

``` cleanup
await box.cleanup();
```
