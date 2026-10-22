// # Bounded session-log retention
//
// `parseSessionLog` streams a transcript forward and counts an exact `total`,
// but retains only what the request's slice names. It used to keep a
// `SessionEntry` for every line and slice at the end — and a retained entry
// holds the whole `tool_use.input` (a `Write` call carries the entire file body)
// and the whole base64 image payload, so the live set was the whole file. That
// took a prod `bbx serve` past its heap cap while serving one big chat
// (2026-08-01).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import {
  parseSessionLog,
  MAX_RETAINED_BYTES,
  MAX_SESSION_ENTRIES,
} from "../../../src/cli/lib/session.js";
import { writeBigSessionLog } from "./session-log-fixture.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { parseInChild } from "./parse-in-child.js";

/** The uuids the fixture's real entries carry between `from` and `to`; the `i % 4 === 2` lines are tool results grafted onto their call. */
function uuids(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, k) => from + k).filter((i) => i % 4 !== 2).map((i) => `uuid-${i}`);
}

/** The entry the tail test writes for message `i`. */
function typed(i: number) {
  return {
    uuid: `u${i}`,
    type: "user" as const,
    timestamp: `2026-01-01T00:0${i}:00Z`,
    content: [{ type: "text" as const, text: `<typed>Message ${i}</typed>` }],
  };
}

// ## A big transcript, parsed with bounded live heap
//
// The fixture is ~2 400 lines carrying ~60 KB of payload each — a 120 MB
// transcript, which is small next to a real long-running session. Asking for
// `tail: 200` retains 200 entries. The child samples the live heap (after a
// forced GC) while the parse runs; `peakLiveMb` is the largest sample above the
// pre-parse baseline. Every retained byte counts against `MAX_RETAINED_BYTES`
// (32 MiB), so a bounded parse stays under 40 MB at every moment, whatever the
// file size. Measured on 2026-10-18: 13 MB here, against 114 MB for a parse that
// holds every entry and slices the tail at the end — the regression this guards,
// which leaves `retainedMb` unchanged because only the peak shows it.
void test("The fixture is ~2 400 lines carrying ~60 KB of payload each — a 120 MB transc...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const logPath = box.path("big.jsonl");
  await writeBigSessionLog({ logPath, lines: 2400, payloadBytes: 60_000 });

  const out = await parseInChild({ logPath, slice: { mode: "tail", tail: 200, minRealUserMessages: 2 } });
  // Heap figures vary by a megabyte with V8 version; the bound is the retained-byte budget plus slack.
  t.check(out, {
    entries: 200,
    total: 1800,
    hasMore: true,
    stubs: 0,
    stubSample: null,
    retainedMb: any(Number).below(40),
    peakLiveMb: any(Number).below(40),
  });

  // A page request of the same transcript is bounded the same way — retention is
  // the window, not the file (3 MB measured):

  const pageOut = await parseInChild({ logPath, slice: { mode: "page", offset: 10, limit: 40 } });
  t.check(pageOut, {
    entries: 40,
    total: 1800,
    hasMore: true,
    stubs: 0,
    stubSample: null,
    retainedMb: any(Number).below(40),
    peakLiveMb: any(Number).below(40),
  });
});

// ## Serialized bytes co-limit the retained tail
//
// The parser separately stubs any single raw line over 256 KiB. A transcript can
// still contain hundreds of entries just under that line limit, so the response
// window also has a 32 MiB serialized-payload ceiling. This fixture uses
// near-limit image and `Write` payloads: `tail: 200` asks for the ordinary full
// chat window, but the byte budget keeps only a shorter suffix while the exact
// `total` and `hasMore` still describe the whole transcript.
void test("The parser separately stubs any single raw line over 256 KiB.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const logPath = box.path("byte-budget.jsonl");
  await writeBigSessionLog({ logPath, lines: 320, payloadBytes: 180_000 });

  const result = await parseSessionLog({
    logPath,
    slice: { mode: "tail", tail: 200 },
  });
  t.check(MAX_RETAINED_BYTES, 32 * 1024 * 1024);
  t.check({ ...result, entries: result.entries.map((e) => e.uuid) }, {
    entries: uuids(97, 319),
    total: 240,
    hasMore: true,
  });

  // Page mode stops before the first entry that would cross the same budget. Its
  // short page reports `hasMore`, so callers advance by the number actually
  // returned and can fetch the next contiguous page without skipping entries.

  const page = await parseSessionLog({
    logPath,
    slice: { mode: "page", offset: 0, limit: 200 },
  });
  t.check({ ...page, entries: page.entries.map((e) => e.uuid) }, {
    entries: uuids(0, 221),
    total: 240,
    hasMore: true,
  });
});

// ## Tail mode keeps the last N entries, and the count stays exact
void test("Tail mode keeps the last N entries, and the count stays exact", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const lines = [];
  for (let i = 0; i < 6; i++) {
    lines.push(JSON.stringify({
      type: "user",
      uuid: `u${i}`,
      timestamp: `2026-01-01T00:0${i}:00Z`,
      message: { role: "user", content: [{ type: "text", text: `<typed>Message ${i}</typed>` }] },
    }));
  }
  await box.write("log.jsonl", lines.join("\n"));

  const result = await parseSessionLog({
    logPath: box.path("log.jsonl"),
    slice: { mode: "tail", tail: 2 },
  });
  t.check(result, { entries: [typed(4), typed(5)], total: 6, hasMore: true });

  // `minRealUserMessages` widens the window until it covers that many real
  // (typed/spoken) user turns — the floor that keeps the chat page from opening on
  // an assistant monologue with no question in view:

  const widened = await parseSessionLog({
    logPath: box.path("log.jsonl"),
    slice: { mode: "tail", tail: 1, minRealUserMessages: 4 },
  });
  t.check(widened, { entries: [typed(2), typed(3), typed(4), typed(5)], total: 6, hasMore: true });

  // Asking for more real user messages than the transcript holds keeps everything
  // it has — up to the hard ceiling, never more:

  const all = await parseSessionLog({
    logPath: box.path("log.jsonl"),
    slice: { mode: "tail", tail: 1, minRealUserMessages: 99 },
  });
  t.check(all, { entries: [0, 1, 2, 3, 4, 5].map(typed), total: 6, hasMore: false });

  // A slice past the ceiling is a programming error, not a bigger read:

  await t.checkThrows(
    () => parseSessionLog({
      logPath: box.path("log.jsonl"),
      slice: { mode: "tail", tail: MAX_SESSION_ENTRIES + 1 },
        }),
    "InvariantError",
  );
});

// ## tool_result grafting still lands inside the retained window
//
// A `tool_result` rides on its `tool_use` block rather than appearing as its own
// message. Grafting walks a bounded window of recent entries, so a result whose
// call is still in view lands; one whose call was already evicted is invisible
// either way, because the evicted entry isn't returned.
void test("A toolresult rides on its tooluse block rather than appearing as its own mess...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("log.jsonl", [
    JSON.stringify({
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/box/a.md" } }],
      },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: "2026-01-01T00:00:01Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file body" }] },
    }),
  ].join("\n"));

  const result = await parseSessionLog({
    logPath: box.path("log.jsonl"),
    slice: { mode: "tail", tail: 200 },
  });
  t.check(result, {
    entries: [
      {
        uuid: "a1",
        type: "assistant",
        timestamp: "2026-01-01T00:00:00Z",
        content: [
          {
            type: "tool_use",
            toolName: "Read",
            toolId: "toolu_1",
            input: { file_path: "/box/a.md" },
            inputSummary: "/box/a.md",
            resultSummary: "file body",
          },
        ],
      },
    ],
    total: 1,
    hasMore: false,
  });
});

// The graft window is the trailing assistant run and nothing more, capped at 256
// entries — so a result whose call sits further back than that (only reachable
// through a tool loop of 256+ consecutive assistant entries with no user turn
// between them, which real transcripts don't produce) no longer finds its call.
// The result is still not lost from view: it stays a `tool_result` block on its
// own entry.
void test("The graft window is the trailing assistant run and nothing more, capped at 25...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const lines = [];
  for (let i = 0; i < 300; i++) {
    lines.push(JSON.stringify({
      type: "assistant",
      uuid: `a${i}`,
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: `toolu_${i}`, name: "Read", input: { file_path: `/box/${i}.md` } }],
      },
    }));
  }
  lines.push(JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:05:00Z",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_0", content: "oldest body" },
        { type: "tool_result", tool_use_id: "toolu_299", content: "newest body" },
      ],
    },
  }));
  await box.write("log.jsonl", lines.join("\n"));

  const result = await parseSessionLog({
    logPath: box.path("log.jsonl"),
    slice: { mode: "tail", tail: 400 },
  });
  // 300 entries with a tool_use block each; only the call still in the window is grafted.
  t.check({ ...result, entries: result.entries.map((e) => [e.uuid, e.content[0]?.resultSummary]) }, {
    entries: Array.from({ length: 300 }, (_, i) => [`a${i}`, i === 299 ? "newest body" : undefined]),
    total: 300,
    hasMore: false,
  });
});
