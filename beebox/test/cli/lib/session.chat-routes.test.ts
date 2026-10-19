// # Chat Routes — Session Parsing & Utilities
//
// Tests for the session log parsing pipeline used by chat history, plus
// pure utility functions relevant to chat routes (content transformation,
// tool input summarization, TTS voice validation).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  parseSessionLog,
  transformContent,
  summarizeToolInput,
  summarizeToolResult,
} from "../../../src/cli/lib/session.js";
import {
  getSessionLogPath,
  containedSessionCwd,
} from "../../../src/core/chat/session/transcript-paths.js";
import type { SessionLogSlice } from "../../../src/cli/lib/session-retention.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import * as path from "node:path";
import * as os from "node:os";

// "Everything, bounded": the first page at the hard retention ceiling. Every
// parseSessionLog call names a slice — there is no unbounded shape.
const ALL = { mode: "page", offset: 0, limit: 5000 } satisfies SessionLogSlice;

// ## getSessionLogPath
//
// Pure path computation — encodes slashes as hyphens:
void test("Pure path computation — encodes slashes as hyphens:", async (t) => {
  t.check(getSessionLogPath("/home/user/mybox", "abc-123"), path.join(os.homedir(), ".claude/projects/-home-user-mybox/abc-123.jsonl"));

});

// ## containedSessionCwd
//
// A landmark-bound chat runs the SDK with its cwd set to a box subdirectory, and
// that `contextDir` is a string read off the box's session-history file. It gets
// joined into a filesystem path — now on behalf of an HTTP request, since
// `/api/session-media` serves a photo out of whichever transcript this resolves
// to. An ordinary binding resolves as you would expect:
void test("A landmark-bound chat runs the SDK with its cwd set to a box subdirectory, an...", async (t) => {
  // doctest:L48
  t.check(containedSessionCwd("/tmp/test-box", "_content/recipes"), path.join("/tmp/test-box", "_content/recipes"));
});

// No binding is the box root:
void test("No binding is the box root:", async (t) => {
  // doctest:L55
  t.check([containedSessionCwd("/tmp/test-box", undefined), containedSessionCwd("/tmp/test-box", "")], [
    "/tmp/test-box",
    "/tmp/test-box",
  ]);
});

// A row that climbs out of the box does **not** get clamped into something
// plausible — it falls back to the box root, so the transcript it names is simply
// not found rather than read from somewhere else:
void test("A row that climbs out of the box does not get clamped into something plausibl...", async (t) => {
  // doctest:L64
  t.check(containedSessionCwd("/tmp/test-box", "../../etc"), "/tmp/test-box");
});

// A leading slash does not make it absolute — `path.join` reads it as
// box-relative, so it lands inside the box rather than at the filesystem root:
void test("A leading slash does not make it absolute — path.join reads it as box-relativ...", async (t) => {
  // doctest:L72
  t.check(containedSessionCwd("/tmp/test-box", "/etc/passwd"), "/tmp/test-box/etc/passwd");
});

// ## parseSessionLog
//
// ### Empty file
void test("Empty file", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L81
  const box = await makeTmpBox();
  await box.write("log.jsonl", "");
  const result = await parseSessionLog({ logPath: box.path("log.jsonl"), slice: ALL });
  t.check(result, { entries: [], total: 0, hasMore: false });
});

// ### User and assistant entries
void test("User and assistant entries", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L100
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
  t.check(result, {
    entries: [
      { uuid: "u1", type: "user", timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text: "Hello" }] },
      { uuid: "a1", type: "assistant", timestamp: "2026-01-01T00:00:01Z", content: [{ type: "text", text: "Hi there!" }] },
    ],
    total: 2,
    hasMore: false,
  });
});

// ### Filters out tool-only user entries
//
// User entries with only tool_result blocks (no real text) are skipped:
void test("User entries with only toolresult blocks (no real text) are skipped:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L139
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
  t.check(result, {
    entries: [
      { uuid: "u2", type: "user", timestamp: "2026-01-01T00:00:01Z", content: [{ type: "text", text: "Real message" }] },
    ],
    total: 1,
    hasMore: false,
  });
});

// ### Filters out non-user/assistant types
//
// System and result entries are skipped:
void test("System and result entries are skipped:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L172
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
  t.check(result, {
    entries: [
      { uuid: "u1", type: "user", timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text: "Only real one" }] },
    ],
    total: 1,
    hasMore: false,
  });
});

// ### Pagination
void test("Pagination", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L196
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
  t.check(result, {
    entries: [
      { uuid: "u2", type: "user", timestamp: "2026-01-01T00:02:00Z", content: [{ type: "text", text: "Message 2" }] },
      { uuid: "u3", type: "user", timestamp: "2026-01-01T00:03:00Z", content: [{ type: "text", text: "Message 3" }] },
    ],
    total: 5,
    hasMore: true,
  });
});

// ## transformContent
//
// ### Text block
void test("Text block", async (t) => {
  // doctest:L228
  const result = transformContent([{ type: "text", text: "hello world" }]);
  t.check(result, [{ type: "text", text: "hello world" }]);
});

// ### String content (legacy format)
void test("String content (legacy format)", async (t) => {
  // doctest:L239
  const result = transformContent("plain string");
  t.check(result, [{ type: "text", text: "plain string" }]);
});

// ### Tool use block
void test("Tool use block", async (t) => {
  // doctest:L250
  const result = transformContent([{
    type: "tool_use",
    name: "Read",
    id: "tool_1",
    input: { file_path: "/tmp/test.ts" },
  }]);
  t.check(result, [{ type: "tool_use", toolName: "Read", toolId: "tool_1", input: { file_path: "/tmp/test.ts" }, inputSummary: "/tmp/test.ts" }]);
});

// ### Tool result block
void test("Tool result block", async (t) => {
  // doctest:L270
  const result = transformContent([{
    type: "tool_result",
    tool_use_id: "tool_1",
    content: "file contents here",
  }]);
  t.check(result, [{ type: "tool_result", toolUseId: "tool_1", resultSummary: "file contents here" }]);
});

// ### Thinking block
void test("Thinking block", async (t) => {
  // doctest:L287
  const result = transformContent([{ type: "thinking", thinking: "Let me consider..." }]);
  t.check(result, [{ type: "thinking", text: "Let me consider..." }]);
});

// ### Redacted thinking
void test("Redacted thinking", async (t) => {
  // doctest:L298
  const result = transformContent([{ type: "redacted_thinking" }]);
  t.check(result, [{ type: "thinking", text: "[redacted]" }]);
});

// ### Empty/non-array content
void test("Empty/non-array content", async (t) => {
  // doctest:L309
  const result = transformContent(null);
  t.check(result, []);
});

// ### Image block (base64)
//
// User-pasted images arrive as image content blocks with a base64 source.
// They're preserved so the chat UI can render them inline.
void test("User-pasted images arrive as image content blocks with a base64 source.", async (t) => {
  // doctest:L320
  const result = transformContent([
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
  ]);
  t.check(result, [{
    type: "image",
    mediaType: "image/png",
    dataBase64: "AAAA",
  }]);
});

// ### Image block (url)
//
// Image blocks using a URL source are preserved as `imageUrl`:
void test("Image blocks using a URL source are preserved as imageUrl:", async (t) => {
  // doctest:L332
  const result = transformContent([
    { type: "image", source: { type: "url", url: "https://example.com/x.png" } }
  ]);
  t.check(result, [{
    type: "image",
    imageUrl: "https://example.com/x.png",
  }]);
});

// ### User turn with only images is dropped as plumbing
//
// Claude Code emits user-role turns containing only image blocks when
// feeding PDF pages to the model. `parseSessionLog` treats these as
// plumbing and filters them out (the surrounding user prose, if any,
// is what carries the real message).
void test("Claude Code emits user-role turns containing only image blocks when feeding P...", async (t) => {
  // doctest:L347
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
  t.check(result, {
    entries: [
      {
        uuid: "u2",
        type: "user",
        timestamp: "t2",
        content: [
          { type: "text", text: "<typed>look</typed>" },
          { type: "image", mediaType: "image/png", dataBase64: "PASTED" },
        ],
      },
    ],
    total: 1,
    hasMore: false,
  });
});

// ## summarizeToolInput
void test("summarizeToolInput", async (t) => {
  // doctest:L378
  t.check(summarizeToolInput("Read", { file_path: "/src/main.ts" }), "/src/main.ts");

  // doctest:L381
  t.check(summarizeToolInput("Bash", { description: "Run tests", command: "npm test" }), "Run tests");

  // doctest:L384
  t.check(summarizeToolInput("Glob", { pattern: "**/*.ts" }), "**/*.ts");

  // doctest:L387
  t.check(summarizeToolInput("Grep", { pattern: "TODO", path: "src/" }), "TODO in src/");

  // doctest:L390
  t.check(summarizeToolInput("TodoWrite", { todos: [] }), "update todos");

  // doctest:L393
  t.check(summarizeToolInput("Write", { file_path: "/tmp/out.txt", content: "hello world" }), "/tmp/out.txt (11 chars)");
});

// ## summarizeToolResult
void test("summarizeToolResult", async (t) => {
  // doctest:L400
  t.check(summarizeToolResult("simple string"), "simple string");

  // doctest:L403
  t.check(summarizeToolResult(["line1", "line2"]), "line1\nline2");
});

// Array with text objects:
void test("Array with text objects:", async (t) => {
  // doctest:L412
  t.check(summarizeToolResult([{ text: "first" }, { text: "second" }]), "first\nsecond");
});

// Non-string/non-array returns empty:
void test("Non-string/non-array returns empty:", async (t) => {
  // doctest:L421
  t.check(summarizeToolResult(42), "");
});
