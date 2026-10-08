# chat-search/extract: transcript entries → chunk documents

Pure extraction: parsed session entries become chunk documents that point
back at their position in the conversation. Only user and assistant text
contributes; tool calls, tool results, and compaction/interrupted markers
are noise. User text is wrapper-stripped (`transcript-render.ts` hygiene) so
speech envelopes don't pollute matches.

```ts setup
import {
  chunkSessionEntries,
  entrySearchText,
  CHUNK_CHAR_BUDGET,
} from "../../../src/core/chat-search/extract.js";
import type { SessionEntry } from "../../../src/cli/lib/session.js";

function entry(
  uuid: string,
  type: "user" | "assistant",
  text: string | null,
  timestamp = "2026-09-28T10:00:00Z",
): SessionEntry {
  return {
    uuid,
    type,
    timestamp,
    content: text === null ? [] : [{ type: "text", text }],
  };
}
```

## One short exchange is one chunk anchored at its first entry

```ts
const docs = chunkSessionEntries({
  sessionId: "11111111-1111-4111-8111-111111111111",
  title: "Insurance follow-up",
  entries: [
    entry("aaa1", "user", "Did the insurance claim go through?"),
    entry("bbb1", "assistant", "Yes — the adjuster approved the roof claim on Tuesday."),
  ],
  fromIndex: 0,
});

docs.length
=> 1

docs[0].id
=> 11111111-1111-4111-8111-111111111111#aaa1

docs[0].anchor
=> aaa1

docs[0].created
=> 2026-09-28T10:00:00Z

docs[0].content.split("\n\n")[0]
=> Did the insurance claim go through?

docs[0].content.split("\n\n")[1]
=> Yes — the adjuster approved the roof claim on Tuesday.
```

## Tool traffic and non-dialogue entries contribute nothing

```ts
const noisy: SessionEntry[] = [
  { uuid: "t1", type: "interrupted", timestamp: "2026-09-28T10:00:00Z", content: [] },
  {
    uuid: "t2",
    type: "assistant",
    timestamp: "2026-09-28T10:00:01Z",
    content: [{ type: "tool_use", toolName: "searchCards", inputSummary: "insurance" }],
  },
  entry("t3", "assistant", ""),
];
entrySearchText(noisy[0]).length
=> 0

entrySearchText(noisy[1]).length
=> 0

entrySearchText(noisy[2]).length
=> 0
```

Continuing: an entry with no text block still counts toward the transcript
cursor (the manifest slices by parsed entry index), but adds nothing to a
chunk.

```ts continue
chunkSessionEntries({
  sessionId: "s",
  title: "",
  entries: [...noisy, entry("t4", "user", "hello")],
  fromIndex: 0,
}).length
=> 1
```

## User text is wrapper-stripped; assistant text is left verbatim

```ts
entrySearchText(
  entry("u1", "user", '<typed user="Ann">what about the roof claim?</typed>')
)
=> what about the roof claim?

entrySearchText(
  entry("a1", "assistant", "The **roof** claim is approved.")
)
=> The **roof** claim is approved.
```

## A chunk closes at the budget; the next entry anchors the next chunk

```ts
const filler = "x".repeat(400);
const docs = chunkSessionEntries({
  sessionId: "s",
  title: "",
  entries: [
    entry("c1", "user", filler),
    entry("c2", "assistant", filler),
    entry("c3", "assistant", filler),
    entry("c4", "assistant", filler),
    entry("c5", "user", "the actual question"),
  ],
  fromIndex: 0,
});

docs.length
=> 2

docs.map((d) => d.anchor).join(",")
=> c1,c5

docs[1].content
=> the actual question
```

Four 400-char entries joined stay just under the 1600-char budget, so they
share one chunk; the fifth entry crosses it and anchors the second. The
check happens before an entry joins, so a chunk never starts empty.

## The cursor chunks only the tail — incremental refresh

```ts
const entries = [
  entry("d1", "user", "first turn"),
  entry("d2", "assistant", "first reply"),
  entry("d3", "user", "later turn"),
];
const full = chunkSessionEntries({ sessionId: "s", title: "", entries, fromIndex: 0 });
const tail = chunkSessionEntries({ sessionId: "s", title: "", entries, fromIndex: 2 });

full.length
=> 1

tail.length
=> 1

tail[0].anchor
=> d3
```

## An oversize entry becomes one whole chunk, not a split one

```ts
const docs = chunkSessionEntries({
  sessionId: "s",
  title: "",
  entries: [entry("e1", "assistant", "y".repeat(CHUNK_CHAR_BUDGET * 3))],
  fromIndex: 0,
});

docs.length
=> 1

docs[0].content.startsWith("yyy")
=> true
```

Unbroken 64+ char runs are split by the shared normalizer so the radix tree
stays shallow:

```ts continue
docs[0].content.includes(" y")
=> true
```
