# buildStreamEntry

`buildStreamEntry` turns the in-flight chat stream buffers (`streamText` +
`streamTools`) into an assistant `SessionEntry`. Both the live message list (the
provisional streaming bubble) and the chat machine's "new"-session rollup use it,
so they agree on shape: tools first, then the text block.

```ts setup
import { buildStreamEntry } from "../../../src/frontend/src/lib/stream-entry.js";
```

Text with no tools — a single text block, the given uuid, assistant type:

```ts
const e = buildStreamEntry({ uuid: "live-abc", streamText: "hello", streamTools: [] });
({ uuid: e.uuid, type: e.type, content: e.content })
=>
{
  "uuid": "live-abc",
  "type": "assistant",
  "content": [
    {
      "type": "text",
      "text": "hello"
    }
  ]
}
```

Tools come before the text block:

```ts
const e = buildStreamEntry({
  uuid: "live-def",
  streamText: "done",
  streamTools: [{ type: "tool_use", name: "Read", id: "t1", input: {} }],
});
e.content.map((b) => b.type)
=>
[
  "tool_use",
  "text"
]
```

Empty text yields no text block (so a just-started turn is an empty container,
not a bubble with a stray empty paragraph):

```ts
const e = buildStreamEntry({ uuid: "live-ghi", streamText: "", streamTools: [] });
e.content
=>
[]
```
