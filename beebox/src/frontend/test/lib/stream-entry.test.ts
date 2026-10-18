// # buildStreamEntry
//
// `buildStreamEntry` turns the in-flight chat stream buffers (`streamText` +
// `streamTools`) into an assistant `SessionEntry`. Both the live message list (the
// provisional streaming bubble) and the chat machine's "new"-session rollup use it,
// so they agree on shape: tools first, then the text block.

import { test } from "tap";
import "agent-doctest/tap";
import { buildStreamEntry } from "../../src/lib/stream-entry.js";

// Text with no tools — a single text block, the given uuid, assistant type:
void test("Text with no tools — a single text block, the given uuid, assistant type:", async (t) => {
  // doctest:L15
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
  // doctest:L33
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

// Empty text yields no text block (so a just-started turn is an empty container,
// not a bubble with a stray empty paragraph):
void test("Empty text yields no text block (so a just-started turn is an empty container...", async (t) => {
  // doctest:L50
  const e = buildStreamEntry({ uuid: "live-ghi", streamText: "", streamTools: [] });
  t.check(e.content, []);
});
