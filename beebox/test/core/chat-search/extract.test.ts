// # chat-search/extract: transcript entries → chunk documents
//
// Pure extraction: parsed session entries become chunk documents that point
// back at their position in the conversation. Only user and assistant text
// contributes; tool calls, tool results, and compaction/interrupted markers
// are noise. User text is wrapper-stripped (`transcript-render.ts` hygiene) so
// speech envelopes don't pollute matches.

import { test } from "tap";
import "agent-doctest/tap";
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
  await t.checkText(docs.length, "1");

  // doctest:L48
  t.check(docs[0]?.id, "11111111-1111-4111-8111-111111111111#aaa1");

  // doctest:L51
  t.check(docs[0]?.anchor, "aaa1");

  // doctest:L54
  t.check(docs[0]?.created, "2026-09-28T10:00:00Z");

  // doctest:L57
  t.check(docs[0]?.content.split("\n\n")[0], "Did the insurance claim go through?");

  // doctest:L60
  t.check(docs[0]?.content.split("\n\n")[1], "Yes — the adjuster approved the roof claim on Tuesday.");
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
  await t.checkText(entrySearchText(interrupted).length, "0");

  // doctest:L79
  await t.checkText(entrySearchText(toolUse).length, "0");

  // doctest:L82
  await t.checkText(entrySearchText(emptyText).length, "0");

  // Continuing: an entry with no text block still counts toward the transcript
  // cursor (the manifest slices by parsed entry index), but adds nothing to a
  // chunk.

  // doctest:L91
  await t.checkText(
    chunkSessionEntries({
      sessionId: "s",
      title: "",
      entries: [...noisy, entry({ uuid: "t4", type: "user", text: "hello" })],
      fromIndex: 0,
    }).length,
    "1",
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
  await t.checkText(docs.length, "2");

  // doctest:L134
  t.check(docs.map((d) => d.anchor).join(","), "c1,c5");

  // doctest:L137
  t.check(docs[1]?.content, "the actual question");
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
  await t.checkText(full.length, "1");

  // doctest:L159
  await t.checkText(tail.length, "1");

  // doctest:L162
  t.check(tail[0]?.anchor, "d3");
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
  await t.checkText(docs.length, "1");

  // doctest:L179
  t.check(docs[0]?.content.startsWith("yyy"), true);

  // Unbroken 64+ char runs are split by the shared normalizer so the radix tree
  // stays shallow:

  // doctest:L187
  t.check(docs[0]?.content.includes(" y"), true);
});
