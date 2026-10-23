// # buildStreamEntry
//
// `buildStreamEntry` turns the in-flight chat stream buffers (`streamText` +
// `streamTools`) into an assistant `SessionEntry`. Both the live message list (the
// provisional streaming bubble) and the chat machine's "new"-session rollup use it,
// so they agree on shape: each tool after the text written before it, then the
// rest of the text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { buildStreamEntry } from "../../src/lib/stream-entry.js";

// Text with no tools — a single text block, the given uuid, assistant type:
void test("Text with no tools — a single text block, the given uuid, assistant type:", async (t) => {
  const e = buildStreamEntry({ uuid: "live-abc", streamText: "hello", streamTools: [] });
  t.check(({ uuid: e.uuid, type: e.type, content: e.content }), {
    uuid: "live-abc",
    type: "assistant",
    content: [
      {
        type: "text",
        text: "hello",
      },
    ],
  });
});

// Tools come before the text block:
void test("Tools come before the text block:", async (t) => {
  const e = buildStreamEntry({
    uuid: "live-def",
    streamText: "done",
    streamTools: [{ type: "tool_use", toolName: "Read", toolId: "t1", input: {} }],
  });
  t.check(e.content.map((b) => b.type), [
    "tool_use",
    "text",
  ]);
});

// Text written before a tool call goes ahead of it. Each tool carries the length
// the streamed text had when it arrived; the offset itself is not kept.
void test("Text written before a tool call goes ahead of it.", async (t) => {
  const e = buildStreamEntry({
    uuid: "live-jkl",
    streamText: "Looking.\n\nFound it.",
    streamTools: [{ type: "tool_use", toolName: "Read", toolId: "t1", input: {}, streamTextOffset: 8 }],
  });
  t.check(e.content, [
    { type: "text", text: "Looking." },
    { type: "tool_use", toolName: "Read", toolId: "t1", input: {} },
    { type: "text", text: "\n\nFound it." },
  ]);
});

// Empty text yields no text block (so a just-started turn is an empty container,
// not a bubble with a stray empty paragraph):
void test("Empty text yields no text block (so a just-started turn is an empty container...", async (t) => {
  const e = buildStreamEntry({ uuid: "live-ghi", streamText: "", streamTools: [] });
  t.check(e.content, []);
});
