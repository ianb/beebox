# One guarded way to read a transcript

`session-oversize.ts` bounds what a scan parses, and for a while `parseSessionLog`
was the only reader that used it. Three others walked the same transcripts and
`JSON.parse`d every line at whatever size it happened to be — on a box with heavy
image use, ~1.3 MB lines whose object graph is several times that.

So the guard moved into the reader every one of them now goes through, and a
caller cannot forget it: it is handed a line already measured against the bound.

```ts setup
import { readTranscriptLines } from "../../../src/cli/lib/session-lines.js";
import { MAX_SESSION_LINE_BYTES } from "../../../src/cli/lib/session-oversize.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { errnoCode } from "../../../src/lib/error-guards.js";

function turn({ uuid, text, imageData }) {
  return JSON.stringify({
    type: "user",
    uuid,
    timestamp: "2026-08-25T10:00:00.000Z",
    message: {
      role: "user",
      content: [
        { type: "text", text },
        ...(imageData === undefined ? [] : [{ type: "image", source: { type: "base64", media_type: "image/png", data: imageData } }]),
      ],
    },
  });
}

const photo = Buffer.from("p".repeat(400_000)).toString("base64");
const hugeText = "z".repeat(MAX_SESSION_LINE_BYTES);

async function kinds(logPath) {
  const seen = [];
  for await (const line of readTranscriptLines(logPath)) {
    seen.push(`${String(line.lineNumber)}:${line.kind}${line.kind === "parseable" && line.mediaStripped ? "+stripped" : ""}`);
  }
  return seen.join(" ");
}

/** The text of each turn the reader handed over as parseable. */
async function parseableTexts(logPath) {
  const out = [];
  for await (const line of readTranscriptLines(logPath)) {
    if (line.kind === "parseable") out.push(JSON.parse(line.text).message.content[0].text);
  }
  return out.join(" | ");
}

/** Line numbers the reader refused to parse. */
async function oversizeLineNumbers(logPath) {
  const out = [];
  for await (const line of readTranscriptLines(logPath)) {
    if (line.kind === "oversize") out.push(line.lineNumber);
  }
  return out;
}

/** How many lines were pulled before breaking out at `needle`. */
async function readUntil(logPath, needle) {
  let read = 0;
  for await (const line of readTranscriptLines(logPath)) {
    read += 1;
    if (line.kind === "parseable" && line.text.includes(needle)) break;
  }
  return read;
}

/** The errno of a read that failed, or "(no error)". */
async function readErrno(logPath) {
  try {
    for await (const _line of readTranscriptLines(logPath)) break;
    return "(no error)";
  } catch (e) {
    return errnoCode(e) ?? "(unknown)";
  }
}
```

## Three answers, one per shape of line

An ordinary line passes through untouched. A line that is oversize only because
it carries a photo comes back parseable with the payload gone — that is what lets
an image-bearing turn be read at all rather than replaced by a placeholder. A
line still past the bound once its images are gone is a genuinely enormous text
turn, and is handed over as `oversize` for the caller to decide about.

```ts
const box = await makeTmpBox();
await box.write("mixed.jsonl", [
  turn({ uuid: "u-1", text: "just words" }),
  turn({ uuid: "u-2", text: "here is the drawer", imageData: photo }),
  turn({ uuid: "u-3", text: hugeText }),
].join("\n"));

await kinds(box.path("mixed.jsonl"))
=> 1:parseable 2:parseable+stripped 3:oversize
```

`mediaStripped` is not cosmetic: it is how a reader tells an image whose bytes
were taken out — still fetchable from this line — from one whose bytes never
arrived (`shared/session-media.ts`). And a stripped line is real JSON, so the
turn's own text survives:

```ts continue
await parseableTexts(box.path("mixed.jsonl"))
=> just words | here is the drawer
```

The line number counts every line, including the ones handed over as oversize,
so it stays a stable identity across re-scans of the same file:

```ts continue
JSON.stringify(await oversizeLineNumbers(box.path("mixed.jsonl")))
=> [3]
```

```ts cleanup
await box.cleanup();
```

## Stopping early does not leak the file handle

`readFirstUserSnippet` reads until the first real user message and then stops —
the whole point there is not reading the rest of a transcript that can be
megabytes. Breaking out of the loop runs the generator's `finally`, which closes
the interface and destroys the stream, so the caller no longer has to remember
to do it (and can no longer forget).

```ts
const box = await makeTmpBox();
await box.write("long.jsonl", [
  turn({ uuid: "u-1", text: "first" }),
  turn({ uuid: "u-2", text: "second" }),
  turn({ uuid: "u-3", text: "third" }),
].join("\n"));

await readUntil(box.path("long.jsonl"), "first")
=> 1
```

A transcript that is not there raises the underlying fs error rather than
reading as empty — the contract the readers already had, and one they rely on:
`readFirstUserSnippet` lets it propagate so an unreadable transcript is not
reported as an unlabeled chat, while `backfill` and the at-most-once probe catch
`ENOENT` and treat it as "no transcript yet". Swallowing it here would take that
choice away from all three:

```ts continue
await readErrno(box.path("never-written.jsonl"))
=> ENOENT
```

```ts cleanup
await box.cleanup();
```
