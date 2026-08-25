# A stripped photo keeps its address

A photo attached in chat is written into the transcript's own JSONL line as
base64 and stored nowhere else. The history path strips those payloads on the
way past (`session-oversize.ts`) because carrying them is what OOM'd production,
and for a while the consequence landed on the person who sent the photo: a
reloaded conversation showed `[image not displayed]` where their photographs
had been.

The bytes were never gone, only left behind. So the reader now emits the
*coordinates* of the payload it skipped — session, entry, and the image's
ordinal in the turn — and a client fetches that one image if and only if
someone looks at it.

```ts setup
import { encodeSessionMediaRef, parseSessionMediaRef } from "../../../src/shared/session-media.js";
import { findTranscriptLineByUuid, MAX_MEDIA_LINE_BYTES } from "../../../src/cli/lib/session-line-scan.js";
import { extractSessionMedia } from "../../../src/cli/lib/session-media-extract.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// A payload big enough to trip the strip threshold, whose plaintext we can
// check on the way back out.
function photo(text) {
  return Buffer.from(text.repeat(200_000)).toString("base64");
}

function turnLine({ uuid, images, text }) {
  return JSON.stringify({
    parentUuid: null,
    type: "user",
    uuid,
    timestamp: "2026-08-24T10:00:00.000Z",
    message: {
      role: "user",
      content: [
        { type: "text", text: `<typed>${text}</typed>` },
        ...images,
      ],
    },
  });
}

function inlineImage({ mediaType, data }) {
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}
```

## A reference is coordinates, not a URL

The server that mints one has no idea what prefix the page is served under, so
it emits a path and the client prepends its own API base.

```ts
encodeSessionMediaRef({ sessionId: "s-1", entryUuid: "u-9", index: 2 })
=> s-1/u-9/2
```

It round-trips:

```ts
JSON.stringify(parseSessionMediaRef("s-1/u-9/2"))
=> {"sessionId":"s-1","entryUuid":"u-9","index":2}
```

Both ids are interpolated into a filesystem path, so the parse is where a
crafted reference has to die. Everything below is `null` — the route answers all
of them with one 400, because there is nothing a client could do differently
with a more specific complaint:

```ts
const rejected = [
  "../../../etc/passwd/u-9/0",   // path separators in the session id
  "s-1/../../secrets/0",          // ...or the entry id
  "s.1/u-9/0",                    // a dot could name a sibling file
  "s-1/u-9",                      // no index
  "s-1/u-9/0/extra",              // too many segments
  "s-1/u-9/-1",                   // not a natural number
  "s-1/u-9/9999",                 // past the per-entry bound
  "s-1/u-9/x",                    // not a number at all
];
JSON.stringify(rejected.map(parseSessionMediaRef))
=> [null,null,null,null,null,null,null,null]
```

## Finding one line without reading the others

The lookup exists because the obvious implementation is the bug: walking the
transcript with `readline` to compare uuids builds a string for *every* line it
passes, including the megabyte ones — so fetching one photo would drag every
other photo through the heap on the way. The search runs over bytes instead, and
only the line it wants ever becomes a string.

```ts
const box = await makeTmpBox();
const logPath = box.path("chat.jsonl");
await box.write("chat.jsonl", [
  turnLine({ uuid: "u-1", text: "first", images: [inlineImage({ mediaType: "image/png", data: photo("a") })] }),
  turnLine({ uuid: "u-2", text: "second", images: [inlineImage({ mediaType: "image/jpeg", data: photo("b") })] }),
  turnLine({ uuid: "u-3", text: "third", images: [inlineImage({ mediaType: "image/png", data: photo("c") })] }),
].join("\n"));

const found = await findTranscriptLineByUuid({ logPath, uuid: "u-2" });
print(`found: ${found.found}`);
print(`is the right line: ${found.line.includes("second")}`);
print(`did not return a neighbour: ${!found.line.includes("first") && !found.line.includes("third")}`);
=>
found: true
is the right line: true
did not return a neighbour: true
```

A `parentUuid` naming the same entry cannot be mistaken for the entry itself —
the needle carries the leading quote of the field name, and `parentUuid` has a
letter there instead:

```ts continue
await box.write("parented.jsonl", [
  JSON.stringify({ type: "user", uuid: "aaa", parentUuid: null, message: { role: "user", content: [{ type: "text", text: "the target" }] } }),
  JSON.stringify({ type: "user", uuid: "bbb", parentUuid: "aaa", message: { role: "user", content: [{ type: "text", text: "the child" }] } }),
].join("\n"));

const parented = await findTranscriptLineByUuid({ logPath: box.path("parented.jsonl"), uuid: "aaa" });
parented.line.includes("the target")
=> true
```

A uuid nothing carries, and a transcript that does not exist yet, are the same
answer — there is no image either way:

```ts continue
const missing = await findTranscriptLineByUuid({ logPath, uuid: "nope" });
const absent = await findTranscriptLineByUuid({ logPath: box.path("never-written.jsonl"), uuid: "u-1" });
JSON.stringify([missing, absent])
=> [{"found":false,"reason":"not-found"},{"found":false,"reason":"not-found"}]
```

The line is materialized to reach one payload inside it, so the size a client
can ask the server to allocate is bounded:

```ts continue
MAX_MEDIA_LINE_BYTES
=> 16777216
```

```ts cleanup
await box.cleanup();
```

## Taking one image out of a line full of them

Parsing the raw line would work and would also rebuild every payload in it —
the allocation the whole guard exists to prevent, re-entered by a different
door. So the payloads come out textually first and the structure is parsed
without them.

A turn carrying two photos, addressed by ordinal:

```ts
const box = await makeTmpBox();
await box.write("two.jsonl", turnLine({
  uuid: "u-two",
  text: "both drawers",
  images: [
    inlineImage({ mediaType: "image/png", data: photo("left") }),
    inlineImage({ mediaType: "image/jpeg", data: photo("right") }),
  ],
}));
const line = (await findTranscriptLineByUuid({ logPath: box.path("two.jsonl"), uuid: "u-two" })).line;

const first = extractSessionMedia({ line, index: 0 });
const second = extractSessionMedia({ line, index: 1 });
print(`first: ${first.media.mediaType} starting ${first.media.bytes.toString("utf8").slice(0, 4)}`);
print(`second: ${second.media.mediaType} starting ${second.media.bytes.toString("utf8").slice(0, 5)}`);
print(`whole photo recovered: ${first.media.bytes.length === 200_000 * 4}`);
=>
first: image/png starting left
second: image/jpeg starting right
whole photo recovered: true
```

Asking for an image the turn does not have is not the same as asking for one
whose bytes never arrived. A failed upload leaves a real image block with
nothing behind it, and saying so separately is what keeps the route from
reporting someone else's upload failure as a missing photograph:

```ts continue
const past = extractSessionMedia({ line, index: 5 });
await box.write("empty.jsonl", turnLine({
  uuid: "u-empty",
  text: "this one did not upload",
  images: [inlineImage({ mediaType: "image/png", data: "" })],
}));
const emptyLine = (await findTranscriptLineByUuid({ logPath: box.path("empty.jsonl"), uuid: "u-empty" })).line;
const empty = extractSessionMedia({ line: emptyLine, index: 0 });
JSON.stringify([past, empty])
=> [{"ok":false,"reason":"no-such-image"},{"ok":false,"reason":"no-payload"}]
```

The `media_type` comes out of the transcript and the route puts it in a
`Content-Type`, so only real image types get through. Anything else degrades to
bytes a browser will not render:

```ts continue
await box.write("html.jsonl", turnLine({
  uuid: "u-html",
  text: "nice try",
  images: [inlineImage({ mediaType: "text/html", data: photo("x") })],
}));
const htmlLine = (await findTranscriptLineByUuid({ logPath: box.path("html.jsonl"), uuid: "u-html" })).line;
extractSessionMedia({ line: htmlLine, index: 0 }).media.mediaType
=> application/octet-stream
```

A line the transcript writer left half-written has no image in it either:

```ts continue
JSON.stringify(extractSessionMedia({ line: '{"type":"user","uuid":"u-1","mess', index: 0 }))
=> {"ok":false,"reason":"unparsable"}
```

```ts cleanup
await box.cleanup();
```
