# Oversize transcript lines are stubbed, not parsed

Bounded *retention* (`session-retention.doctest.md`) does not bound *allocation*:
`parseSessionLog` still `JSON.parse`d every line to decide what to keep. Prod's
box-family session was 15.5 MB across 1 587 lines with **14 lines over 1 MB**
each (capture-image and tool payloads), so one `chat.history` request cost
~50 MB of transient heap, and concurrent requests stacked linearly into the
1.9 GB V8 cap — four `cb serve` OOMs on 2026-08-03/04.

So the scan refuses to parse a line longer than `MAX_SESSION_LINE_BYTES` and
records a placeholder entry instead.

```ts setup
import { parseSessionLog, MAX_SESSION_LINE_BYTES } from "../../../src/cli/lib/session.js";
import { isRealUserMessage } from "../../../src/cli/lib/session-real-user.js";
import { writeGiantLineSessionLog } from "../../helpers/session-log-fixture.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "../../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/helpers/parse-session-log-child.ts");

// Parse in a child process under a hard heap cap — the ceiling is enforced by
// V8, not by an in-process assertion a parse could pass while allocating the
// world. (Same harness as session-retention.doctest.md.)
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

The threshold is far above any human-authored turn and far below the ~1.3 MB
capture payloads that caused the incident:

```ts
MAX_SESSION_LINE_BYTES
=> 262144
```

## A transcript of 1 MB+ lines parses under a 64 MB heap cap

40 giant lines of ~1.2 MB payload each (~65 MB of payload once base64 inflation
is counted), interleaved with normal-sized turns. `tail: 200` covers the whole
file, so retention bounds nothing here — only the per-line byte bound keeps the
parse inside the cap.

```ts
const box = await makeTmpBox();
const logPath = box.path("giant.jsonl");
await writeGiantLineSessionLog({ logPath, giantLines: 40, giantBytes: 1_200_000, normalLinesBetween: 3 });

const run = await parseUnderHeapCap(logPath, { mode: "tail", tail: 200, minRealUserMessages: 2 }, 64);
const out = JSON.parse(run.stdout);
print(`exit: ${run.code}`);
print(`entries: ${out.entries}`);
print(`total: ${out.total}`);
print(`stubs: ${out.stubs}`);
print(`stub sample: ${out.stubSample}`);
print(`heap under cap: ${out.heapUsedMb < 64}`);
=>
exit: 0
entries: 120
total: 120
stubs: 40
stub sample: [message too large to display: ~«int» KB]
heap under cap: true
```

Without the bound the same child died at the cap:

    FATAL ERROR: Ineffective mark-compacts near heap limit
    Allocation failed - JavaScript heap out of memory

Not parsing the line is only half of it: the stub must not *hold on to* the line
either. `line.slice(0, n)` and the regex captures taken from it are sliced
strings that keep the whole 1.3 MB parent alive, so a first cut of this guard
still ended the scan holding ~64 MB in 40 stubs. `session-oversize.ts` copies
the sniffed head out with a Buffer round-trip; this same test caught that.

```ts cleanup
await box.cleanup();
```

## What a stub is, and what it is not

A stub is a normal `SessionEntry` — there is no new `SessionEntry.type`, because
the frontend's union is closed and narrows on it. The entry type is sniffed out
of the head of the raw line; the content is one text block, mirroring the
unknown-block placeholder `session-content.ts` already renders.

```ts
const box = await makeTmpBox();
const fat = "z".repeat(MAX_SESSION_LINE_BYTES);
await box.write("log.jsonl", [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "<typed>hello</typed>" }] },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "a-huge",
    timestamp: "2026-01-01T00:01:00Z",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { content: fat } }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "u-huge",
    timestamp: "2026-01-01T00:02:00Z",
    message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: fat } }] },
  }),
].join("\n"));

const result = await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: 200 },
});
JSON.stringify(result.entries.map((e) => ({ uuid: e.uuid, type: e.type, blocks: e.content.length })))
=> [{"uuid":"u1","type":"user","blocks":1},{"uuid":"a-huge","type":"assistant","blocks":1},{"uuid":"u-huge","type":"user","blocks":1}]
```

The uuid and timestamp are sniffed too, so a stub still sorts and identifies
like the entry it stands for:

```ts continue
JSON.stringify(result.entries[1])
=> {"uuid":"a-huge","type":"assistant","timestamp":"2026-01-01T00:01:00Z","content":[{"type":"text","text":"[message too large to display: ~«int» KB]"}]}
```

A stub counts as **one displayable entry** toward `total`, so `total`/`hasMore`
stay honest about how much transcript exists:

```ts continue
JSON.stringify({ total: result.total, hasMore: result.hasMore })
=> {"total":3,"hasMore":false}
```

A stub is **never** a real user message, even when the line it replaced was a
typed one — the tail-window floor (`minRealUserMessages`) stays anchored to
genuinely-parsed user text rather than to a placeholder that shows the human
nothing:

```ts continue
JSON.stringify(result.entries.map(isRealUserMessage))
=> [true,false,false]
```

So widening the tail to cover two real user messages keeps only the one real
message this transcript has, and the ceiling stops the widening rather than the
stubs satisfying it:

```ts continue
const widened = await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: 1, minRealUserMessages: 2 },
});
JSON.stringify({ entries: widened.entries.length, real: widened.entries.filter(isRealUserMessage).length })
=> {"entries":3,"real":1}
```

```ts cleanup
await box.cleanup();
```

## Oversize plumbing is dropped, not shown

The length check runs before `buildEntry`, so without care an oversize line
would bypass every filter `buildEntry` applies and appear as a message the
parsed version never was — an oversize `tool_result` (the commonest fat line of
all) turning into a visible user turn that also inflates `total`. The head sniff
recognizes the shapes the scan drops anyway: system records, SDK meta prompts,
synthetic assistant turns, and tool_result plumbing.

```ts
const box = await makeTmpBox();
const fat = "z".repeat(MAX_SESSION_LINE_BYTES);
await box.write("log.jsonl", [
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "<typed>hello</typed>" }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "plumbing",
    timestamp: "2026-01-01T00:01:00Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: fat }] },
  }),
  JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    uuid: "sys",
    timestamp: "2026-01-01T00:02:00Z",
    payload: fat,
  }),
  JSON.stringify({
    type: "user",
    uuid: "meta",
    isMeta: true,
    timestamp: "2026-01-01T00:03:00Z",
    message: { role: "user", content: [{ type: "text", text: fat }] },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "synth",
    timestamp: "2026-01-01T00:04:00Z",
    message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: fat }] },
  }),
].join("\n"));

const result = await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: 200 },
});
JSON.stringify({ uuids: result.entries.map((e) => e.uuid), total: result.total })
=> {"uuids":["u1"],"total":1}
```

A shape the sniff does not recognize still becomes a stub. An unexplained gap in
the transcript is the worse failure, so the fallback is visible rather than
silent. With no `uuid` in the head, the stub falls back to a synthesized
per-line identity (`oversize-<line number>`) rather than an empty string —
several empty-uuid stubs in one scan would otherwise collide as React keys:

```ts continue
await box.write("mystery.jsonl", JSON.stringify({ payload: fat }));
const mystery = await parseSessionLog({
  logPath: box.path("mystery.jsonl"),
  slice: { mode: "tail", tail: 200 },
});
JSON.stringify(mystery.entries.map((e) => ({ type: e.type, uuid: e.uuid })))
=> [{"type":"assistant","uuid":"oversize-1"}]
```

Two mystery lines in the same file get distinct fallback ids, so they don't
collide:

```ts continue
await box.write("mystery2.jsonl", [
  JSON.stringify({ payload: fat }),
  JSON.stringify({ payload: fat }),
].join("\n"));
const mystery2 = await parseSessionLog({
  logPath: box.path("mystery2.jsonl"),
  slice: { mode: "tail", tail: 200 },
});
JSON.stringify(mystery2.entries.map((e) => e.uuid))
=> ["oversize-1","oversize-2"]
```

The threshold is UTF-8 bytes, not characters, so a payload of multi-byte
characters can't slip under it. This line is 100 000 characters — well under the
262 144 threshold as a code-unit count — but 300 KB encoded:

```ts continue
const cjk = "漢".repeat(100_000);
await box.write("cjk.jsonl", JSON.stringify({
  type: "assistant",
  uuid: "cjk",
  timestamp: "2026-01-01T00:00:00Z",
  message: { role: "assistant", content: [{ type: "text", text: cjk }] },
}));
const wide = await parseSessionLog({
  logPath: box.path("cjk.jsonl"),
  slice: { mode: "tail", tail: 200 },
});
JSON.stringify(wide.entries.map((e) => e.content[0].text))
=> ["[message too large to display: ~293 KB]"]
```

```ts cleanup
await box.cleanup();
```

## An oversize tool call loses its grafted result

`graftToolResults` matches a `tool_result` to the `tool_use` block of a recent
assistant entry. A stub has no `tool_use` block, so the result stays on its own
turn ungrafted — the same accepted degradation as a call whose entry was evicted
by retention (`session-retention.ts`). Deliberate: the alternative is parsing the
line we refused to parse.

```ts
const box = await makeTmpBox();
const fat = "z".repeat(MAX_SESSION_LINE_BYTES);
await box.write("log.jsonl", [
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { content: fat } }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-01T00:00:01Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "File created successfully." }] },
  }),
].join("\n"));

const result = await parseSessionLog({
  logPath: box.path("log.jsonl"),
  slice: { mode: "tail", tail: 200 },
});
JSON.stringify(result.entries.map((e) => e.content.map((b) => b.type)))
=> [["text"]]
```

The `tool_result` turn itself is still dropped as plumbing, exactly as it is
when the call parsed normally — nothing new appears in the transcript, the
result summary is simply not shown next to the call.

```ts cleanup
await box.cleanup();
```
