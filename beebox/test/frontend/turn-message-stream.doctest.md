# handleTurnMessage — streaming block dedup

`handleTurnMessage` maps a turn's SDK frames onto the chat machine's
`STREAM_*` events. The SDK emits **one assistant message per content
block**, and a streamed text block's `text_delta` events always arrive
immediately before that block's own assistant frame. So the assistant
frame's text is a *duplicate* of what the deltas already surfaced —
except when a block arrives with **no deltas at all** (atomic
delivery), which is common for post-tool text and `![](…)` embeds.

The `sawTextPartial` latch must therefore be scoped to the *current*
block: it's reset after every assistant frame. A turn-global latch
dropped every atomic block after the first streamed one — the
"intermediate text/embeds vanish, only the last block renders" bug.

```ts setup
import { handleTurnMessage } from "../../src/frontend/src/machines/chat-actors.js";
import type { ChatMessage } from "../../src/core/chat/session/messages.js";
import type { ChatEvent } from "../../src/frontend/src/machines/chat-types.js";

function delta(text: string): ChatMessage {
  return { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } };
}
function asstText(text: string): ChatMessage {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}
function asstTool(id: string): ChatMessage {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: {} }] } };
}

// Drive a sequence of frames through one turn's shared state and return the
// text the machine would accumulate (STREAM_TEXT joined) plus the tool count.
function runTurn(frames: ChatMessage[]): { text: string; tools: number } {
  const state = { sawTextPartial: false };
  const events: ChatEvent[] = [];
  const sink = (event: ChatEvent): void => { events.push(event); };
  for (const msg of frames) {
    handleTurnMessage(msg, { sessionInput: "s", sendBack: sink, terminal: sink, state });
  }
  const text = events.filter((e) => e.type === "STREAM_TEXT").map((e) => (e as { text: string }).text).join("");
  const tools = events.filter((e) => e.type === "STREAM_TOOL").length;
  return { text, tools };
}
```

## A streamed block is surfaced once (deltas win, atomic frame skipped)

```ts
const { text } = runTurn([
  delta("Hello "),
  delta("world"),
  asstText("Hello world"),
]);
text;
=>
Hello world
```

## An atomic block (no deltas) is surfaced from its assistant frame

```ts
const { text } = runTurn([
  asstText("No deltas here"),
]);
text;
=>
No deltas here
```

## Interleaved turn: atomic post-tool text/embeds all survive

This is the regression. Opening narration streams via deltas; two
embed blocks arrive atomically after tool calls; a third arrives via
deltas; a final line arrives atomically. Every block must appear
exactly once — none dropped, none duplicated.

```ts
const { text, tools } = runTurn([
  delta("Opening narration."),
  asstText("Opening narration."),           // dup of deltas — skipped
  asstTool("t1"),
  asstText("![Embed A](/a.png)"),            // atomic — kept
  asstTool("t2"),
  delta("![Embed B](/b.png)"),
  asstText("![Embed B](/b.png)"),            // dup of deltas — skipped
  asstText("Final narration line."),         // atomic — kept
]);
print(`tools: ${tools}`);
text;
=>
tools: 2
Opening narration.![Embed A](/a.png)![Embed B](/b.png)Final narration line.
```

## Two consecutive atomic blocks both survive

```ts
const { text } = runTurn([
  asstText("First atomic."),
  asstText("Second atomic."),
]);
text;
=>
First atomic.Second atomic.
```

## Two consecutive streamed blocks are each surfaced once

```ts
const { text } = runTurn([
  delta("Alpha"),
  asstText("Alpha"),
  delta("Beta"),
  asstText("Beta"),
]);
text;
=>
AlphaBeta
```
