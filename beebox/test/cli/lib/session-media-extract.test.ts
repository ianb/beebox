// # A stripped photo keeps its address
//
// A photo attached in chat is written into the transcript's own JSONL line as
// base64 and stored nowhere else. The history path strips those payloads on the
// way past (`session-oversize.ts`) because carrying them is what OOM'd production,
// and for a while the consequence landed on the person who sent the photo: a
// reloaded conversation showed `[image not displayed]` where their photographs
// had been.
//
// The bytes were never gone, only left behind. So the reader now emits the
// *coordinates* of the payload it skipped — session, entry, and the image's
// ordinal in the turn — and a client fetches that one image if and only if
// someone looks at it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { encodeSessionMediaRef, parseSessionMediaRef } from "../../../src/shared/session-media.js";
import { findTranscriptLineByUuid } from "../../../src/cli/lib/session-line-scan.js";
import { extractSessionMedia } from "../../../src/cli/lib/session-media-extract.js";
import type { ExtractResult, ExtractedMedia } from "../../../src/cli/lib/session-media-extract.js";
import assert from "node:assert/strict";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// A payload big enough to trip the strip threshold, whose plaintext we can
// check on the way back out.
function photo(text: string) {
  return Buffer.from(text.repeat(200_000)).toString("base64");
}

function turnLine({ uuid, images, text }: { uuid: string; images: readonly object[]; text: string }) {
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

function inlineImage({ mediaType, data }: { mediaType: string; data: string }) {
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

/** The line a lookup found; a lookup that finds nothing fails the example. */
async function lineOf(logPath: string, uuid: string): Promise<string> {
  const result = await findTranscriptLineByUuid({ logPath, uuid });
  assert.ok(result.found);
  return result.line;
}

/** The media of a successful extraction; a failed one fails the example. */
function mediaOf(result: ExtractResult): ExtractedMedia {
  assert.ok(result.ok);
  return result.media;
}

// ## A reference is coordinates, not a URL
//
// The server that mints one has no idea what prefix the page is served under, so
// it emits a path and the client prepends its own API base.
void test("The server that mints one has no idea what prefix the page is served under, s...", async (t) => {
  t.check(encodeSessionMediaRef({ sessionId: "s-1", entryUuid: "u-9", index: 2 }), "s-1/u-9/2");
});

// It round-trips:
void test("It round-trips:", async (t) => {
  t.check(parseSessionMediaRef("s-1/u-9/2"), {
    sessionId: "s-1",
    entryUuid: "u-9",
    index: 2,
  });
});

// Both ids are interpolated into a filesystem path, so the parse is where a
// crafted reference has to die. Everything below is `null` — the route answers all
// of them with one 400, because there is nothing a client could do differently
// with a more specific complaint:
void test("Both ids are interpolated into a filesystem path, so the parse is where a cra...", async (t) => {
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
  t.check(rejected.map(parseSessionMediaRef), [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
});

// ## Finding one line without reading the others
//
// The lookup exists because the obvious implementation is the bug: walking the
// transcript with `readline` to compare uuids builds a string for *every* line it
// passes, including the megabyte ones — so fetching one photo would drag every
// other photo through the heap on the way. The search runs over bytes instead, and
// only the line it wants ever becomes a string.
void test("The lookup exists because the obvious implementation is the bug:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const logPath = box.path("chat.jsonl");
  const second = turnLine({ uuid: "u-2", text: "second", images: [inlineImage({ mediaType: "image/jpeg", data: photo("b") })] });
  await box.write("chat.jsonl", [
    turnLine({ uuid: "u-1", text: "first", images: [inlineImage({ mediaType: "image/png", data: photo("a") })] }),
    second,
    turnLine({ uuid: "u-3", text: "third", images: [inlineImage({ mediaType: "image/png", data: photo("c") })] }),
  ].join("\n"));

  // The whole line comes back, and only that one: not a neighbour.
  t.check(await findTranscriptLineByUuid({ logPath, uuid: "u-2" }), { found: true, line: second });

  // A `parentUuid` naming the same entry cannot be mistaken for the entry itself —
  // the needle carries the leading quote of the field name, and `parentUuid` has a
  // letter there instead:

  const target = JSON.stringify({ type: "user", uuid: "aaa", parentUuid: null, message: { role: "user", content: [{ type: "text", text: "the target" }] } });
  const child = JSON.stringify({ type: "user", uuid: "bbb", parentUuid: "aaa", message: { role: "user", content: [{ type: "text", text: "the child" }] } });
  await box.write("parented.jsonl", [target, child].join("\n"));

  t.check(await lineOf(box.path("parented.jsonl"), "aaa"), target);

  // A uuid nothing carries, and a transcript that does not exist yet, are the same
  // answer — there is no image either way:

  const missing = await findTranscriptLineByUuid({ logPath, uuid: "nope" });
  const absent = await findTranscriptLineByUuid({ logPath: box.path("never-written.jsonl"), uuid: "u-1" });
  t.check([missing, absent], [{ found: false, reason: "not-found" }, { found: false, reason: "not-found" }]);
});

// ## Taking one image out of a line full of them
//
// Parsing the raw line would work and would also rebuild every payload in it —
// the allocation the whole guard exists to prevent, re-entered by a different
// door. So the payloads come out textually first and the structure is parsed
// without them.
//
// A turn carrying two photos, addressed by ordinal:
void test("Parsing the raw line would work and would also rebuild every payload in it —...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("two.jsonl", turnLine({
    uuid: "u-two",
    text: "both drawers",
    images: [
      inlineImage({ mediaType: "image/png", data: photo("left") }),
      inlineImage({ mediaType: "image/jpeg", data: photo("right") }),
    ],
  }));
  const line = await lineOf(box.path("two.jsonl"), "u-two");

  const first = extractSessionMedia({ line, index: 0 });
  const second = extractSessionMedia({ line, index: 1 });
  // Each photo comes back whole, with its own media type.
  t.check(
    [first, second].map((r) => ({ mediaType: mediaOf(r).mediaType, text: mediaOf(r).bytes.toString("utf8") })),
    [
      { mediaType: "image/png", text: "left".repeat(200_000) },
      { mediaType: "image/jpeg", text: "right".repeat(200_000) },
    ],
  );

  // Asking for an image the turn does not have is not the same as asking for one
  // whose bytes never arrived. A failed upload leaves a real image block with
  // nothing behind it, and saying so separately is what keeps the route from
  // reporting someone else's upload failure as a missing photograph:

  const past = extractSessionMedia({ line, index: 5 });
  await box.write("empty.jsonl", turnLine({
    uuid: "u-empty",
    text: "this one did not upload",
    images: [inlineImage({ mediaType: "image/png", data: "" })],
  }));
  const emptyLine = await lineOf(box.path("empty.jsonl"), "u-empty");
  const empty = extractSessionMedia({ line: emptyLine, index: 0 });
  t.check([past, empty], [{ ok: false, reason: "no-such-image" }, { ok: false, reason: "no-payload" }]);

  // The `media_type` comes out of the transcript and the route puts it in a
  // `Content-Type`, so only real image types get through. Anything else degrades to
  // bytes a browser will not render:

  await box.write("html.jsonl", turnLine({
    uuid: "u-html",
    text: "nice try",
    images: [inlineImage({ mediaType: "text/html", data: photo("x") })],
  }));
  const htmlLine = await lineOf(box.path("html.jsonl"), "u-html");
  t.check(mediaOf(extractSessionMedia({ line: htmlLine, index: 0 })).mediaType, "application/octet-stream");

  // A line the transcript writer left half-written has no image in it either:

  t.check(extractSessionMedia({ line: '{"type":"user","uuid":"u-1","mess', index: 0 }), { ok: false, reason: "unparsable" });
});
