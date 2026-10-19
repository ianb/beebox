// # ChatSession
//
// Tests for the `ChatSession` class: session ID persistence, state accessors,
// reset, and history loading. These tests don't spawn a real Claude process.

import { test } from "tap";
import "agent-doctest/tap";
import { instanceOf } from "agent-doctest/check";
import { ChatSession, buildContentBlocks } from "../../../../src/core/chat/session/run/core.js";
import { chatHistorySlice } from "../../../../src/core/chat/session/load-history.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ## Constructor — no saved session
//
// A new ChatSession on an empty box has no session and is idle:
void test("A new ChatSession on an empty box has no session and is idle:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L20
  const box = await makeTmpBox();
  const session = new ChatSession(box.root);
  t.check(
    { sessionId: session.getSessionId(), running: session.isRunning(), busy: session.isBusy() },
    { sessionId: null, running: false, busy: false },
  );
});

// ## Session ID persistence — save then load
//
// Writing a session file before constructing ChatSession loads it:
void test("Writing a session file before constructing ChatSession loads it:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L40
  const box = await makeTmpBox();
  const dir = path.join(box.root, ".beebox");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "chat-session-id.json"),
    JSON.stringify({ sessionId: "test-abc-123", savedAt: "2026-01-01T00:00:00Z" })
  );
  const session = new ChatSession(box.root);
  t.check(session.getSessionId(), "test-abc-123");
});

// ## Session ID persistence — corrupt file
//
// Invalid JSON in the session file is handled gracefully:
void test("Invalid JSON in the session file is handled gracefully:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L61
  const box = await makeTmpBox();
  const dir = path.join(box.root, ".beebox");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "chat-session-id.json"), "not json{{{");
  const session = new ChatSession(box.root);
  t.check(session.getSessionId(), null);
});

// ## resetSession — clears file and state
//
// Reset deletes the session file and clears the in-memory session ID:
void test("Reset deletes the session file and clears the in-memory session ID:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L79
  const box = await makeTmpBox();
  const dir = path.join(box.root, ".beebox");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "chat-session-id.json"),
    JSON.stringify({ sessionId: "to-reset" })
  );
  const session = new ChatSession(box.root);
  t.check(session.getSessionId(), "to-reset");

  // doctest:L90
  session.resetSession();
  t.check(session.getSessionId(), null);

  // doctest:L94
  const exists = await fs.access(path.join(dir, "chat-session-id.json")).then(() => true, () => false);
  t.check(exists, false);
});

// ## resetSession — no file to delete
//
// Reset on a session with no file doesn't throw:
void test("Reset on a session with no file doesn't throw:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L108
  const box = await makeTmpBox();
  const session = new ChatSession(box.root);
  session.resetSession();
  t.check(session.getSessionId(), null);
});

// ## getHistory — no session
//
// With no session ID, getHistory returns empty:
void test("With no session ID, getHistory returns empty:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L124
  const box = await makeTmpBox();
  const session = new ChatSession(box.root);
  const history = await session.getHistory(chatHistorySlice());
  t.check(history, { sessionId: null, entries: [], total: 0 });
});

// ## getHistory — session but no log file
//
// With a session ID but no actual log file on disk, returns empty entries:
void test("With a session ID but no actual log file on disk, returns empty entries:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L143
  const box = await makeTmpBox();
  const dir = path.join(box.root, ".beebox");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "chat-session-id.json"),
    JSON.stringify({ sessionId: "orphan-session" })
  );
  const session = new ChatSession(box.root);
  const history = await session.getHistory(chatHistorySlice());
  t.check(history, { sessionId: "orphan-session", entries: [], total: 0 });
});

// ## getHistory — an unreadable log throws, it does not read as empty
//
// A read error is NOT an empty transcript. Only `ENOENT` means "no log yet"; any
// other failure propagates, because callers act on the result — `chat-schedule-fire`
// broadcasts it to every open tab, so degrading to `{ entries: [] }` would visibly
// clear a live conversation on a transient I/O error.
//
// Here the log path is a *directory*, so the read fails `EISDIR`:
void test("A read error is NOT an empty transcript.", async (t) => {
  t.teardown(async () => {
    try {
      if (previousProjects === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      else process.env["BBX_CLAUDE_PROJECTS_DIR"] = previousProjects;
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L173
  const box = await makeTmpBox();
  const previousProjects = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = path.join(box.root, "claude-projects");
  const dir = path.join(box.root, ".beebox");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "chat-session-id.json"),
    JSON.stringify({ sessionId: "unreadable-session" })
  );
  await fs.mkdir(getSessionLogPath(box.root, "unreadable-session"), { recursive: true });
  const session = new ChatSession(box.root);

  // doctest:L185
  let thrown = null;
  try {
    await session.getHistory(chatHistorySlice());
  } catch (e) {
    thrown = e;
  }
  t.check(thrown, instanceOf(Error));
  t.check(thrown, {
    name: "Error",
    message: "EISDIR: illegal operation on a directory, read",
    errno: -21,
    code: "EISDIR",
    syscall: "read",
  });
});

// ## buildContentBlocks — text only (no images)
//
// With no images, the helper returns a single text block unchanged:
void test("With no images, the helper returns a single text block unchanged:", async (t) => {
  // doctest:L209
  t.check(buildContentBlocks({ text: "hello world" }), [
    {
      type: "text",
      text: "hello world",
    },
  ]);
});

// ## buildContentBlocks — inline image replacement
//
// An `[image#N]` token in the text is replaced with the matching image block,
// and the surrounding text is split into separate blocks:
void test("An [image#N] token in the text is replaced with the matching image block, and...", async (t) => {
  // doctest:L219
  const imgs = [{ id: 1, mimeType: "image/png", dataBase64: "AAAA" }];
  const blocks = buildContentBlocks({ text: "before [image#1] after", images: imgs });
  t.check(blocks, [
    {
      type: "text",
      text: "before ",
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "AAAA",
      },
    },
    {
      type: "text",
      text: " after",
    },
  ]);
});

// ## buildContentBlocks — unreferenced images append at end
//
// Images without a matching `[image#N]` token get appended after the text:
void test("Images without a matching [image#N] token get appended after the text:", async (t) => {
  // doctest:L230
  const imgs = [{ id: 1, mimeType: "image/jpeg", dataBase64: "QQ==" }];
  const blocks = buildContentBlocks({ text: "no token here", images: imgs });
  t.check(blocks, [
    { type: "text", text: "no token here" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QQ==" } },
  ]);
});

// ## buildContentBlocks — orphan tokens left as literal text
//
// A `[image#9]` token with no matching attachment stays as literal text
// (rather than being silently dropped):
void test("A [image#9] token with no matching attachment stays as literal text (rather t...", async (t) => {
  // doctest:L242
  const imgs = [{ id: 1, mimeType: "image/png", dataBase64: "X" }];
  const blocks = buildContentBlocks({ text: "[image#9] is orphan [image#1] real", images: imgs });
  t.check(blocks, [
    {
      type: "text",
      text: "[image#9] is orphan ",
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "X",
      },
    },
    {
      type: "text",
      text: " real",
    },
  ]);
});

// ## buildContentBlocks — multiple images in order
//
// Two different images resolve to different blocks at their respective
// token positions. Spelled here in the pre-2026-08-25 form, without the `#`:
// every transcript written before then looks like this, and replaying one has to
// land the photos in the same places it always did.
void test("Two different images resolve to different blocks at their respective token po...", async (t) => {
  // doctest:L256
  const imgs = [
    { id: 1, mimeType: "image/png", dataBase64: "ONE" },
    { id: 2, mimeType: "image/png", dataBase64: "TWO" },
  ];
  const blocks = buildContentBlocks({ text: "dog [image2] cat [image1]", images: imgs });
  t.check(blocks, [
    { type: "text", text: "dog " },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "TWO" } },
    { type: "text", text: " cat " },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "ONE" } },
  ]);
});

// ## buildContentBlocks — the `<attachments>` block keeps its image lines
//
// An inline image whose original was uploaded is listed in the trailing
// `<attachments>` block as `[image#N]: _tmp/…`, the same way a file is. That
// line re-spells the token, and it is NOT an anchor: expanding it would splice a
// second copy of the image into the block. The body token becomes the image
// block; the line stays text, so the agent reads the path right after the
// pixels.
void test("An inline image whose original was uploaded is listed in the trailing <attach...", async (t) => {
  // doctest:L275
  const imgs = [{ id: 1, mimeType: "image/png", dataBase64: "PX" }];
  const text = "<typed>why is this wrong? [image#1]</typed>\n<attachments>\n[image#1]: _tmp/2026-09-16T10-00-00.000Z_shot.png\n</attachments>";
  const blocks = buildContentBlocks({ text, images: imgs });
  t.check(blocks, [
    { type: "text", text: "<typed>why is this wrong? " },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "PX" } },
    {
      type: "text",
      text: `</typed>
<attachments>
[image#1]: _tmp/2026-09-16T10-00-00.000Z_shot.png
</attachments>`,
    },
  ]);
});

// An image referenced ONLY in the block (its body token was edited out) is still
// appended as a block, exactly as an unreferenced image always was:
void test("An image referenced ONLY in the block (its body token was edited out) is stil...", async (t) => {
  // doctest:L286
  const imgs = [{ id: 1, mimeType: "image/png", dataBase64: "PX" }];
  const text = "<typed>edited out</typed>\n<attachments>\n[image#1]: _tmp/x.png\n</attachments>";
  t.check(buildContentBlocks({ text, images: imgs }), [
    {
      type: "text",
      text: `<typed>edited out</typed>
<attachments>
[image#1]: _tmp/x.png
</attachments>`,
    },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "PX" } },
  ]);
});
