// # Empty assistant entries
//
// An assistant entry does not create a message when its parts have no visible content. This applies to both saved history and the provisional streaming entry.

import { test } from "tap";
import "agent-doctest/tap";
import { groupIntoParts, hasRenderableAssistantContent } from "../../../src/components/chat/message-parsing.js";
import { buildDataItems } from "../../../src/components/chat/everywhere/InteractiveChat/message-items.js";
import type { SessionEntry, SessionContentBlock } from "../../../src/api.js";

const assistant = (content: SessionContentBlock[]): SessionEntry => ({
  uuid: "assistant-1", type: "assistant", timestamp: "2026-01-01T00:00:00Z", content,
});
interface ItemsOptions {
  streamingShown: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  proseEnabled: boolean;
}

const items = (entries: SessionEntry[], options?: Partial<ItemsOptions>) => buildDataItems({
  groups: entries.length > 0 ? [{ type: "assistant", entries }] : [],
  modelMarkers: [], streamingShown: options?.streamingShown ?? false, streamText: options?.streamText ?? "",
  streamTools: options?.streamTools ?? [], liveTurnId: "turn-1",
  pendingHq: [], captureBubbles: [], debugView: false, proseEnabled: options?.proseEnabled ?? true,
});

// An empty Claude thinking block, including an empty progress update, disappears before activity grouping.
void test("An empty Claude thinking block, including an empty progress update, disappear...", async (t) => {
  // doctest:L23
  t.check(groupIntoParts([assistant([{ type: "thinking", text: "" }, { type: "thinking", text: " ", progressUpdate: true }])]), []);

  // doctest:L26
  await t.checkText(items([assistant([{ type: "thinking", text: "" }])]).length, "0");
});

// Whitespace and text removed by the message renderer do not leave an assistant bubble in history.
void test("Whitespace and text removed by the message renderer do not leave an assistant...", async (t) => {
  // doctest:L33
  await t.checkText(items([assistant([{ type: "text", text: "  \n  " }])]).length, "0");

  // doctest:L36
  await t.checkText(items([assistant([{ type: "text", text: "<chat-app mode=\"silent\"/>" }])]).length, "0");

  // doctest:L39
  await t.checkText(items([assistant([{ type: "thinking", text: "Reasoning" }, { type: "text", text: '<ack kind="no-response"/>' }])]).length, "0");
});

// The streaming placeholder is absent until a complete visible chunk or a tool call arrives.
void test("The streaming placeholder is absent until a complete visible chunk or a tool...", async (t) => {
  // doctest:L46
  await t.checkText(items([], { streamingShown: true }).length, "0");

  // doctest:L49
  await t.checkText(items([], { streamingShown: true, streamText: "Half-typed sentence" }).length, "0");

  // doctest:L52
  await t.checkText(items([], { streamingShown: true, streamText: "Ready.\n\n" }).length, "1");
});

// Real activity still renders, including a tool following empty thinking and a progress update with text.
void test("Real activity still renders, including a tool following empty thinking and a...", async (t) => {
  // doctest:L59
  t.check(hasRenderableAssistantContent([assistant([{ type: "thinking", text: "" }, { type: "tool_use", toolName: "Read", toolId: "tool-1", input: {} }])]), true);

  // doctest:L62
  t.check(hasRenderableAssistantContent([assistant([{ type: "thinking", text: "Checking", progressUpdate: true }])]), true);
});

// Narration mode hides prose and tool activity, so only a speech control or a callout makes an assistant message visible.
void test("Narration mode hides prose and tool activity, so only a speech control or a c...", async (t) => {
  // doctest:L69
  await t.checkText(items([assistant([{ type: "tool_use", toolName: "Read", toolId: "tool-1", input: {} }, { type: "text", text: "Done." }])], { proseEnabled: false }).length, "0");

  // doctest:L72
  await t.checkText(items([assistant([{ type: "text", text: '<callout context="Result">Done.</callout>' }])], { proseEnabled: false }).length, "1");
});
