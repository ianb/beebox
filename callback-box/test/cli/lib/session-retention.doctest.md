# Bounded session-log retention

`parseSessionLog` streams a transcript forward and counts an exact `total`,
but retains only what the request's slice names. It used to keep a
`SessionEntry` for every line and slice at the end — and a retained entry
holds the whole `tool_use.input` (a `Write` call carries the entire file body)
and the whole base64 image payload, so the live set was the whole file. That
took a prod `cb serve` past its heap cap while serving one big chat
(2026-08-01).

```ts setup
import {
  parseSessionLog,
  MAX_RETAINED_BYTES,
  MAX_SESSION_ENTRIES,
} from "../../../src/cli/lib/session.js";
import { writeBigSessionLog } from "../../helpers/session-log-fixture.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "../../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/helpers/parse-session-log-child.ts");

// Parse in a child process under a hard heap cap. The whole point is that the
// ceiling is enforced by V8, not by an in-process assertion a parse could pass
// while still allocating the world.
function parseUnderHeapCap(logPath, slice, heapMb) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, "--import", "tsx", CHILD_SCRIPT, logPath, JSON.stringify(slice)],
      { cwd: PACKAGE_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += String(c); });
    child.stderr.on("data", (c) => { stderr += String(c); });
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
```

## A big transcript, parsed under a 64 MB heap cap

The fixture is ~2 400 lines carrying ~30 KB of payload each — a 58 MB
transcript, which is small next to a real long-running session but already
far past a 64 MB heap once every entry is retained. Asking for `tail: 200`
retains 200 entries and the child finishes well under the cap.

```ts
const box = await makeTmpBox();
const logPath = box.path("big.jsonl");
await writeBigSessionLog({ logPath, lines: 2400, payloadBytes: 30_000 });

const run = await parseUnderHeapCap(logPath, { mode: "tail", tail: 200, minRealUserMessages: 2 }, 64);
const out = JSON.parse(run.stdout);
print(`exit: ${run.code}`);
print(`entries: ${out.entries}`);
print(`total: ${out.total}`);
print(`hasMore: ${out.hasMore}`);
print(`heap under cap: ${out.heapUsedMb < 64}`);
=>
exit: 0
entries: 200
total: 1800
hasMore: true
heap under cap: true
```

Before the bound, this same child (parsing the whole file, then slicing a tail
of 200 off it) died at the cap:

    FATAL ERROR: Ineffective mark-compacts near heap limit
    Allocation failed - JavaScript heap out of memory
    exit=134

A page request of the same transcript is bounded the same way — retention is
the window, not the file:

```ts continue
const paged = await parseUnderHeapCap(logPath, { mode: "page", offset: 10, limit: 40 }, 64);
const pageOut = JSON.parse(paged.stdout);
print(`exit: ${paged.code}`);
print(`entries: ${pageOut.entries}`);
print(`total: ${pageOut.total}`);
print(`hasMore: ${pageOut.hasMore}`);
=>
exit: 0
entries: 40
total: 1800
hasMore: true
```

```ts cleanup
await box.cleanup();
```

## Serialized bytes co-limit the retained tail

The parser separately stubs any single raw line over 256 KiB. A transcript can
still contain hundreds of entries just under that line limit, so the response
window also has a 32 MiB serialized-payload ceiling. This fixture uses
near-limit image and `Write` payloads: `tail: 200` asks for the ordinary full
chat window, but the byte budget keeps only a shorter suffix while the exact
`total` and `hasMore` still describe the whole transcript.

```ts
const box = await makeTmpBox();
const logPath = box.path("byte-budget.jsonl");
await writeBigSessionLog({ logPath, lines: 320, payloadBytes: 180_000 });

const result = await parseSessionLog({
  logPath,
  slice: { mode: "tail", tail: 200 },
});
print(`budget MiB: ${MAX_RETAINED_BYTES / (1024 * 1024)}`);
print(`entries below tail: ${result.entries.length < 200}`);
print(`total: ${result.total}`);
print(`hasMore: ${result.hasMore}`);
=>
budget MiB: 32
entries below tail: true
total: 240
hasMore: true
```

Page mode stops before the first entry that would cross the same budget. Its
short page reports `hasMore`, so callers advance by the number actually
returned and can fetch the next contiguous page without skipping entries.

```ts continue
const page = await parseSessionLog({
  logPath,
  slice: { mode: "page", offset: 0, limit: 200 },
});
print(`entries below limit: ${page.entries.length < 200}`);
print(`total: ${page.total}`);
print(`hasMore: ${page.hasMore}`);
=>
entries below limit: true
total: 240
hasMore: true
```

```ts cleanup
await box.cleanup();
```

## Tail mode keeps the last N entries, and the count stays exact

```ts
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
print(`entries: ${result.entries.map((e) => e.content[0].text).join(", ")}`);
print(`total: ${result.total}`);
print(`hasMore: ${result.hasMore}`);
=>
entries: <typed>Message 4</typed>, <typed>Message 5</typed>
total: 6
hasMore: true
```

`minRealUserMessages` widens the window until it covers that many real
(typed/spoken) user turns — the floor that keeps the chat page from opening on
an assistant monologue with no question in view:

```ts continue
const widened = await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: 1, minRealUserMessages: 4 },
});
widened.entries.length
=> 4
```

Asking for more real user messages than the transcript holds keeps everything
it has — up to the hard ceiling, never more:

```ts continue
const all = await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: 1, minRealUserMessages: 99 },
});
all.entries.length
=> 6
```

A slice past the ceiling is a programming error, not a bigger read:

```ts continue
await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: MAX_SESSION_ENTRIES + 1 },
}).then(() => "no error", (e) => e.name)
=> InvariantError
```

```ts cleanup
await box.cleanup();
```

## tool_result grafting still lands inside the retained window

A `tool_result` rides on its `tool_use` block rather than appearing as its own
message. Grafting walks a bounded window of recent entries, so a result whose
call is still in view lands; one whose call was already evicted is invisible
either way, because the evicted entry isn't returned.

```ts
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
print(`entries: ${result.entries.length}`);
print(`grafted: ${result.entries[0].content[0].resultSummary}`);
=>
entries: 1
grafted: file body
```

```ts cleanup
await box.cleanup();
```

The graft window is the trailing assistant run and nothing more, capped at 256
entries — so a result whose call sits further back than that (only reachable
through a tool loop of 256+ consecutive assistant entries with no user turn
between them, which real transcripts don't produce) no longer finds its call.
The result is still not lost from view: it stays a `tool_result` block on its
own entry.

```ts
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
print(`entries: ${result.entries.length}`);
print(`oldest grafted: ${result.entries[0].content[0].resultSummary}`);
print(`newest grafted: ${result.entries[299].content[0].resultSummary}`);
=>
entries: 300
oldest grafted: undefined
newest grafted: newest body
```

```ts cleanup
await box.cleanup();
```
