# Chat session-id file handoff

Tests for `session-id-file.ts` — the per-subprocess file the chat backend uses
to hand a fresh conversation's SDK session id to a `cb chat` command running
inside that subprocess (see the "See as the user" plan, Track B session
identity). A resumed session carries its id in `CB_CHAT_SESSION_ID`; a new
session's id is assigned after spawn, so the backend writes it into a unique
file named by `CB_CHAT_SESSION_ID_FILE`, and `resolveChatSessionId` reads it.

```ts setup
import {
  CB_CHAT_SESSION_ID_ENV,
  CB_CHAT_SESSION_ID_FILE_ENV,
  allocateSessionIdFilePath,
  writeSessionIdFile,
  readSessionIdFile,
  cleanupSessionIdFile,
  resolveChatSessionId,
} from "../../../src/core/chat/session/session-id-file.js";
import * as fs from "node:fs";
```

## Allocated paths are unique and not created eagerly

`allocateSessionIdFilePath` returns a fresh path each call and touches no disk —
an unconsumed spawn leaves nothing behind:

```ts
const a = allocateSessionIdFilePath();
const b = allocateSessionIdFilePath();
print(`distinct: ${a !== b}`);
print(`exists: ${fs.existsSync(a)}`);
=>
distinct: true
exists: false
```

## Write then read round-trips the id

```ts
const p = allocateSessionIdFilePath();
writeSessionIdFile(p, "sess-abc-123");
readSessionIdFile(p)
=> sess-abc-123
```

```ts continue
// A later reassignment (id changed) overwrites in place.
writeSessionIdFile(p, "sess-def-456");
readSessionIdFile(p)
=> sess-def-456
```

```ts cleanup
cleanupSessionIdFile(p);
```

## Reading an absent or empty file yields null

```ts
readSessionIdFile(allocateSessionIdFilePath()) === null
=> true
```

```ts
const p = allocateSessionIdFilePath();
fs.writeFileSync(p, "   \n");
const r = readSessionIdFile(p);
fs.rmSync(p);
r === null
=> true
```

## cleanup is idempotent on a missing path

```ts
cleanupSessionIdFile(allocateSessionIdFilePath());
"ok"
=> ok
```

## resolveChatSessionId prefers the direct env var

`CB_CHAT_SESSION_ID` (a resume) wins with no file read and no wait:

```ts
const savedId = process.env[CB_CHAT_SESSION_ID_ENV];
const savedFile = process.env[CB_CHAT_SESSION_ID_FILE_ENV];
process.env[CB_CHAT_SESSION_ID_ENV] = "resumed-777";
const id = await resolveChatSessionId();
if (savedId === undefined) delete process.env[CB_CHAT_SESSION_ID_ENV];
else process.env[CB_CHAT_SESSION_ID_ENV] = savedId;
id
=> resumed-777
```

## resolveChatSessionId falls back to the file when no direct env var

```ts
const p = allocateSessionIdFilePath();
writeSessionIdFile(p, "new-sess-999");
const savedId = process.env[CB_CHAT_SESSION_ID_ENV];
const savedFile = process.env[CB_CHAT_SESSION_ID_FILE_ENV];
delete process.env[CB_CHAT_SESSION_ID_ENV];
process.env[CB_CHAT_SESSION_ID_FILE_ENV] = p;
const id = await resolveChatSessionId();
if (savedId !== undefined) process.env[CB_CHAT_SESSION_ID_ENV] = savedId;
if (savedFile === undefined) delete process.env[CB_CHAT_SESSION_ID_FILE_ENV];
else process.env[CB_CHAT_SESSION_ID_FILE_ENV] = savedFile;
cleanupSessionIdFile(p);
id
=> new-sess-999
```

## resolveChatSessionId waits briefly, then returns null if the id never lands

With the file path set but never written, a short `waitMs` elapses and the
command degrades to "no session" rather than hanging:

```ts
const p = allocateSessionIdFilePath();
const savedId = process.env[CB_CHAT_SESSION_ID_ENV];
const savedFile = process.env[CB_CHAT_SESSION_ID_FILE_ENV];
delete process.env[CB_CHAT_SESSION_ID_ENV];
process.env[CB_CHAT_SESSION_ID_FILE_ENV] = p;
const started = Date.now();
const id = await resolveChatSessionId({ waitMs: 250 });
const waited = Date.now() - started;
if (savedId !== undefined) process.env[CB_CHAT_SESSION_ID_ENV] = savedId;
if (savedFile === undefined) delete process.env[CB_CHAT_SESSION_ID_FILE_ENV];
else process.env[CB_CHAT_SESSION_ID_FILE_ENV] = savedFile;
print(`id: ${id}`);
print(`waited-at-least-250ms: ${waited >= 250}`);
=>
id: null
waited-at-least-250ms: true
```

## resolveChatSessionId returns null with no session context at all

```ts
const savedId = process.env[CB_CHAT_SESSION_ID_ENV];
const savedFile = process.env[CB_CHAT_SESSION_ID_FILE_ENV];
delete process.env[CB_CHAT_SESSION_ID_ENV];
delete process.env[CB_CHAT_SESSION_ID_FILE_ENV];
const id = await resolveChatSessionId();
if (savedId !== undefined) process.env[CB_CHAT_SESSION_ID_ENV] = savedId;
if (savedFile !== undefined) process.env[CB_CHAT_SESSION_ID_FILE_ENV] = savedFile;
id === null
=> true
```
