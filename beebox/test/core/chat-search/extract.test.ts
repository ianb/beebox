// # chat-search/extract: transcript entries → chunk documents
//
// Pure extraction: parsed session entries become chunk documents that point
// back at their position in the conversation. Only user and assistant text
// contributes; tool calls, tool results, and compaction/interrupted markers
// are noise. User text is wrapper-stripped (`transcript-render.ts` hygiene) so
// speech envelopes don't pollute matches.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  chunkSessionEntries,
  entrySearchText,
  CHUNK_CHAR_BUDGET,
} from "../../../src/core/chat-search/extract.js";
import type { SessionEntry } from "../../../src/cli/lib/session.js";

function entry({
  uuid,
  type,
  text,
  timestamp,
}: {
  uuid: string;
  type: "user" | "assistant";
  text: string | null;
  timestamp?: string;
}): SessionEntry {
  return {
    uuid,
    type,
    timestamp: timestamp ?? "2026-09-28T10:00:00Z",
    content: text === null ? [] : [{ type: "text", text }],
  };
}

// ## One short exchange is one chunk anchored at its first entry
void test("One short exchange is one chunk anchored at its first entry", async (t) => {
  // doctest:L35
  const docs = chunkSessionEntries({
    sessionId: "11111111-1111-4111-8111-111111111111",
    title: "Insurance follow-up",
    entries: [
      entry({ uuid: "aaa1", type: "user", text: "Did the insurance claim go through?" }),
      entry({ uuid: "bbb1", type: "assistant", text: "Yes — the adjuster approved the roof claim on Tuesday." }),
    ],
    fromIndex: 0,
  });

  // doctest:L45
  t.check(docs, [
    {
      id: "11111111-1111-4111-8111-111111111111#aaa1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      anchor: "aaa1",
      title: "Insurance follow-up",
      content: "Did the insurance claim go through?\n\nYes — the adjuster approved the roof claim on Tuesday.",
      created: "2026-09-28T10:00:00Z",
    },
  ]);
});

// ## Tool traffic and non-dialogue entries contribute nothing
void test("Tool traffic and non-dialogue entries contribute nothing", async (t) => {
  // doctest:L67
  const interrupted: SessionEntry = { uuid: "t1", type: "interrupted", timestamp: "2026-09-28T10:00:00Z", content: [] };
  const toolUse: SessionEntry = {
    uuid: "t2",
    type: "assistant",
    timestamp: "2026-09-28T10:00:01Z",
    content: [{ type: "tool_use", toolName: "searchCards", inputSummary: "insurance" }],
  };
  const emptyText = entry({ uuid: "t3", type: "assistant", text: "" });
  const noisy: SessionEntry[] = [interrupted, toolUse, emptyText];
  t.check(entrySearchText(interrupted), "");
  t.check(entrySearchText(toolUse), "");
  t.check(entrySearchText(emptyText), "");

  // Continuing: an entry with no text block still counts toward the transcript
  // cursor (the manifest slices by parsed entry index), but adds nothing to a
  // chunk.

  // doctest:L91
  t.check(
    chunkSessionEntries({
      sessionId: "s",
      title: "",
      entries: [...noisy, entry({ uuid: "t4", type: "user", text: "hello" })],
      fromIndex: 0,
    }),
    [{ id: "s#t4", sessionId: "s", anchor: "t4", title: "", content: "hello", created: "2026-09-28T10:00:00Z" }],
  );
});

// ## User text is wrapper-stripped; assistant text is left verbatim
void test("User text is wrapper-stripped; assistant text is left verbatim", async (t) => {
  // doctest:L103
  t.check(
    entrySearchText(
      entry({ uuid: "u1", type: "user", text: '<typed user="Ann">what about the roof claim?</typed>' })
    ),
    "what about the roof claim?",
  );

  // doctest:L108
  t.check(
    entrySearchText(
      entry({ uuid: "a1", type: "assistant", text: "The **roof** claim is approved." })
    ),
    "The **roof** claim is approved.",
  );
});

// ## A chunk closes at the budget; the next entry anchors the next chunk
void test("A chunk closes at the budget; the next entry anchors the next chunk", async (t) => {
  // doctest:L117
  const filler = "x".repeat(400);
  const docs = chunkSessionEntries({
    sessionId: "s",
    title: "",
    entries: [
      entry({ uuid: "c1", type: "user", text: filler }),
      entry({ uuid: "c2", type: "assistant", text: filler }),
      entry({ uuid: "c3", type: "assistant", text: filler }),
      entry({ uuid: "c4", type: "assistant", text: filler }),
      entry({ uuid: "c5", type: "user", text: "the actual question" }),
    ],
    fromIndex: 0,
  });

  // doctest:L131
  // The shared normalizer splits each 400-char run of "x" into 64-char words.
  const filler400 = [...Array.from({ length: 6 }, () => "x".repeat(64)), "x".repeat(16)].join(" ");
  t.check(docs, [
    {
      id: "s#c1",
      sessionId: "s",
      anchor: "c1",
      title: "",
      content: [filler400, filler400, filler400, filler400].join("\n\n"),
      created: "2026-09-28T10:00:00Z",
    },
    {
      id: "s#c5",
      sessionId: "s",
      anchor: "c5",
      title: "",
      content: "the actual question",
      created: "2026-09-28T10:00:00Z",
    },
  ]);
});

// Four 400-char entries joined stay just under the 1600-char budget, so they
// share one chunk; the fifth entry crosses it and anchors the second. The
// check happens before an entry joins, so a chunk never starts empty.
//
// ## The cursor chunks only the tail — incremental refresh
void test("Four 400-char entries joined stay just under the 1600-char budget, so they sh...", async (t) => {
  // doctest:L148
  const entries = [
    entry({ uuid: "d1", type: "user", text: "first turn" }),
    entry({ uuid: "d2", type: "assistant", text: "first reply" }),
    entry({ uuid: "d3", type: "user", text: "later turn" }),
  ];
  const full = chunkSessionEntries({ sessionId: "s", title: "", entries, fromIndex: 0 });
  const tail = chunkSessionEntries({ sessionId: "s", title: "", entries, fromIndex: 2 });

  // doctest:L156
  t.check(full, [
    {
      id: "s#d1",
      sessionId: "s",
      anchor: "d1",
      title: "",
      content: "first turn\n\nfirst reply\n\nlater turn",
      created: "2026-09-28T10:00:00Z",
    },
  ]);
  t.check(tail, [
    { id: "s#d3", sessionId: "s", anchor: "d3", title: "", content: "later turn", created: "2026-09-28T10:00:00Z" },
  ]);
});

// ## An oversize entry becomes one whole chunk, not a split one
void test("An oversize entry becomes one whole chunk, not a split one", async (t) => {
  // doctest:L169
  const docs = chunkSessionEntries({
    sessionId: "s",
    title: "",
    entries: [entry({ uuid: "e1", type: "assistant", text: "y".repeat(CHUNK_CHAR_BUDGET * 3) })],
    fromIndex: 0,
  });

  // doctest:L176
  // Unbroken 64+ char runs are split by the shared normalizer so the radix tree
  // stays shallow:
  t.check(docs, [
    {
      id: "s#e1",
      sessionId: "s",
      anchor: "e1",
      title: "",
      content: Array.from({ length: 75 }, () => "y".repeat(64)).join(" ") + " ",
      created: "2026-09-28T10:00:00Z",
    },
  ]);
});
