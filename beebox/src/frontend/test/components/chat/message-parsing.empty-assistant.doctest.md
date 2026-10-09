# Empty assistant entries

An assistant entry does not create a message when its parts have no visible content. This applies to both saved history and the provisional streaming entry.

```ts setup
import { groupIntoParts, hasRenderableAssistantContent } from "../../../src/components/chat/message-parsing.js";
import { buildDataItems } from "../../../src/components/chat/everywhere/InteractiveChat/message-items.js";
import type { SessionEntry, SessionContentBlock } from "../../../src/api.js";

const assistant = (content: SessionContentBlock[]): SessionEntry => ({
  uuid: "assistant-1", type: "assistant", timestamp: "2026-01-01T00:00:00Z", content,
});
const items = (entries: SessionEntry[], streamingShown = false, streamText = "", streamTools: SessionContentBlock[] = [], proseEnabled = true) => buildDataItems({
  groups: entries.length ? [{ type: "assistant", entries }] : [],
  modelMarkers: [], streamingShown, streamText, streamTools, liveTurnId: "turn-1",
  pendingHq: [], captureBubbles: [], debugView: false, proseEnabled,
});
```

An empty Claude thinking block, including an empty progress update, disappears before activity grouping.

```ts
groupIntoParts([assistant([{ type: "thinking", text: "" }, { type: "thinking", text: " ", progressUpdate: true }])])
=> []

items([assistant([{ type: "thinking", text: "" }])]).length
=> 0
```

Whitespace and text removed by the message renderer do not leave an assistant bubble in history.

```ts
items([assistant([{ type: "text", text: "  \n  " }])]).length
=> 0

items([assistant([{ type: "text", text: "<chat-app mode=\"silent\"/>" }])]).length
=> 0

items([assistant([{ type: "thinking", text: "Reasoning" }, { type: "text", text: '<ack kind="no-response"/>' }])]).length
=> 0
```

The streaming placeholder is absent until a complete visible chunk or a tool call arrives.

```ts
items([], true).length
=> 0

items([], true, "Half-typed sentence").length
=> 0

items([], true, "Ready.\n\n").length
=> 1
```

Real activity still renders, including a tool following empty thinking and a progress update with text.

```ts
hasRenderableAssistantContent([assistant([{ type: "thinking", text: "" }, { type: "tool_use", name: "Read", id: "tool-1", input: {} }])])
=> true

hasRenderableAssistantContent([assistant([{ type: "thinking", text: "Checking", progressUpdate: true }])])
=> true
```

Narration mode hides prose and tool activity, so only a speech control or a callout makes an assistant message visible.

```ts
items([assistant([{ type: "tool_use", name: "Read", id: "tool-1", input: {} }, { type: "text", text: "Done." }])], false, "", [], false).length
=> 0

items([assistant([{ type: "text", text: '<callout context="Result">Done.</callout>' }])], false, "", [], false).length
=> 1
```
