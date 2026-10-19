// # Chat session-id file handoff
//
// Tests for `session-id-file.ts` — the per-subprocess file the chat backend uses
// to hand a fresh conversation's SDK session id to a `bbx chat` command running
// inside that subprocess (see the "See as the user" plan, Track B session
// identity). A resumed session carries its id in `BBX_CHAT_SESSION_ID`; a new
// session's id is assigned after spawn, so the backend writes it into a unique
// file named by `BBX_CHAT_SESSION_ID_FILE`, and `resolveChatSessionId` reads it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import {
  BBX_CHAT_SESSION_ID_ENV,
  BBX_CHAT_SESSION_ID_FILE_ENV,
  allocateSessionIdFilePath,
  writeSessionIdFile,
  readSessionIdFile,
  cleanupSessionIdFile,
  resolveChatSessionId,
} from "../../../../src/core/chat/session/id-file.js";
import * as fs from "node:fs";

// ## Allocated paths are unique and not created eagerly
//
// `allocateSessionIdFilePath` returns a fresh path each call and touches no disk —
// an unconsumed spawn leaves nothing behind:
void test("allocateSessionIdFilePath returns a fresh path each call and touches no disk...", async (t) => {
  // doctest:L29
  const a = allocateSessionIdFilePath();
  const b = allocateSessionIdFilePath();
  t.check(a, not(b));
  t.check(fs.existsSync(a), false);
});

// ## Write then read round-trips the id
void test("Write then read round-trips the id", async (t) => {
  t.teardown(async () => {
    try {
      cleanupSessionIdFile(p);
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L41
  const p = allocateSessionIdFilePath();
  writeSessionIdFile(p, "sess-abc-123");
  t.check(readSessionIdFile(p), "sess-abc-123");

  // doctest:L48
  // A later reassignment (id changed) overwrites in place.
  writeSessionIdFile(p, "sess-def-456");
  t.check(readSessionIdFile(p), "sess-def-456");
});

// ## Reading an absent or empty file yields null
void test("Reading an absent or empty file yields null", async (t) => {
  // doctest:L61
  t.check(readSessionIdFile(allocateSessionIdFilePath()), null);
});

void test("Reading an absent or empty file yields null (line 65)", async (t) => {
  // doctest:L66
  const p = allocateSessionIdFilePath();
  fs.writeFileSync(p, "   \n");
  const r = readSessionIdFile(p);
  fs.rmSync(p);
  t.check(r, null);
});

// ## cleanup removes the file and is idempotent
//
// Cleanup deletes the file; a second cleanup, on a path that no longer exists,
// does nothing and creates nothing:
void test("Cleanup deletes the file; a second cleanup, on a path that no longer exists,...", async (t) => {
  // doctest:L80
  const p = allocateSessionIdFilePath();
  writeSessionIdFile(p, "to-remove");
  const before = fs.existsSync(p);
  cleanupSessionIdFile(p);
  const afterFirst = fs.existsSync(p);
  cleanupSessionIdFile(p);
  t.check([before, afterFirst, fs.existsSync(p)], [
    true,
    false,
    false,
  ]);
});

// ## resolveChatSessionId prefers the direct env var
//
// `BBX_CHAT_SESSION_ID` (a resume) wins with no file read and no wait:
void test("BBXCHATSESSIONID (a resume) wins with no file read and no wait:", async (t) => {
  // doctest:L95
  const savedId = process.env[BBX_CHAT_SESSION_ID_ENV];
  process.env[BBX_CHAT_SESSION_ID_ENV] = "resumed-777";
  const id = await resolveChatSessionId();
  if (savedId === undefined) delete process.env[BBX_CHAT_SESSION_ID_ENV];
  else process.env[BBX_CHAT_SESSION_ID_ENV] = savedId;
  t.check(id, "resumed-777");
});

// ## resolveChatSessionId falls back to the file when no direct env var
void test("resolveChatSessionId falls back to the file when no direct env var", async (t) => {
  // doctest:L108
  const p = allocateSessionIdFilePath();
  writeSessionIdFile(p, "new-sess-999");
  const savedId = process.env[BBX_CHAT_SESSION_ID_ENV];
  const savedFile = process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  delete process.env[BBX_CHAT_SESSION_ID_ENV];
  process.env[BBX_CHAT_SESSION_ID_FILE_ENV] = p;
  const id = await resolveChatSessionId();
  if (savedId !== undefined) process.env[BBX_CHAT_SESSION_ID_ENV] = savedId;
  if (savedFile === undefined) delete process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  else process.env[BBX_CHAT_SESSION_ID_FILE_ENV] = savedFile;
  cleanupSessionIdFile(p);
  t.check(id, "new-sess-999");
});

// ## resolveChatSessionId waits briefly, then returns null if the id never lands
//
// With the file path set but never written, a short `waitMs` elapses and the
// command degrades to "no session" rather than hanging:
void test("With the file path set but never written, a short waitMs elapses and the comm...", async (t) => {
  // doctest:L129
  const p = allocateSessionIdFilePath();
  const savedId = process.env[BBX_CHAT_SESSION_ID_ENV];
  const savedFile = process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  delete process.env[BBX_CHAT_SESSION_ID_ENV];
  process.env[BBX_CHAT_SESSION_ID_FILE_ENV] = p;
  const started = Date.now();
  const id = await resolveChatSessionId({ waitMs: 250 });
  const waited = Date.now() - started;
  if (savedId !== undefined) process.env[BBX_CHAT_SESSION_ID_ENV] = savedId;
  if (savedFile === undefined) delete process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  else process.env[BBX_CHAT_SESSION_ID_FILE_ENV] = savedFile;
  t.check({ id, waited }, { id: null, waited: any(Number).between(250, Infinity) });
});

// ## resolveChatSessionId returns null with no session context at all
void test("resolveChatSessionId returns null with no session context at all", async (t) => {
  // doctest:L150
  const savedId = process.env[BBX_CHAT_SESSION_ID_ENV];
  const savedFile = process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  delete process.env[BBX_CHAT_SESSION_ID_ENV];
  delete process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  const id = await resolveChatSessionId();
  if (savedId !== undefined) process.env[BBX_CHAT_SESSION_ID_ENV] = savedId;
  if (savedFile !== undefined) process.env[BBX_CHAT_SESSION_ID_FILE_ENV] = savedFile;
  t.check(id, null);
});
