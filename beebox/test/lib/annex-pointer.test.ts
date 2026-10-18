// # annexPointer
//
// Detects and parses git-annex pointer files — the short text stand-in a
// working tree holds when an annexed file's content is not present. See
// `src/lib/annex-pointer.ts`.
//
// Two situations produce a pointer and they look identical on disk: content that
// was never fetched, and a checkout made without git-annex installed. Both mean
// "these are not the bytes you asked for", so one predicate serves the annex
// doctor and every content read path.

import { test } from "tap";
import "agent-doctest/tap";
import { isAnnexPointer, parseAnnexPointer, describeAbsentContent } from "../../src/lib/annex-pointer.js";

/** Encode text as the bytes a reader would get off disk. */
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A real pointer, verbatim from a git-annex 10.20260717 repo. */
const POINTER =
  "/annex/objects/SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg\n";

// A pointer parses into its key, expected size, and expected hash — all three
// carried in the key itself, so a caller can say what the content *should* be
// without fetching it:
void test("A pointer parses into its key, expected size, and expected hash — all three c...", async (t) => {
  // doctest:L30
  const p = parseAnnexPointer(bytes(POINTER));
  t.check(p?.size, 300000);

  // doctest:L34
  t.check(p?.sha256, "2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92");

  // doctest:L37
  t.check(p?.key, "SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg");
});

// The trailing newline is optional, and an extensionless key (a file with no
// suffix, as bulk upload can produce) parses the same way:
void test("The trailing newline is optional, and an extensionless key (a file with no su...", async (t) => {
  // doctest:L45
  t.check(isAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "a".repeat(64) + ".jpg")), true);

  // doctest:L48
  t.check(isAnnexPointer(bytes("/annex/objects/SHA256-s12--" + "b".repeat(64))), true);
});

// Ordinary content is rejected. The binary case matters most: a real JPEG must
// never be mistaken for a pointer, and it is rejected on the UTF-8 decode
// without inspecting its structure.
void test("Ordinary content is rejected.", async (t) => {
  // doctest:L57
  t.check(isAnnexPointer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), false);

  // doctest:L60
  t.check(isAnnexPointer(bytes("a normal card body\n")), false);

  // doctest:L63
  t.check(isAnnexPointer(new Uint8Array([])), false);
});

// Near-misses fail closed rather than half-parsing. A path that merely *starts*
// like a pointer, a key whose hash is the wrong length, and a non-hex digest are
// all ordinary content as far as a reader is concerned:
void test("Near-misses fail closed rather than half-parsing.", async (t) => {
  // doctest:L72
  t.check(isAnnexPointer(bytes("/annex/objects/nonsense")), false);

  // doctest:L75
  t.check(isAnnexPointer(bytes("/annex/objects/")), false);
});

// A wrong-length or non-hex digest is still a *pointer* — the file is a stand-in
// for content either way — it just cannot report a `sha256`:
void test("A wrong-length or non-hex digest is still a pointer — the file is a stand-in...", async (t) => {
  // doctest:L83
  const odd = parseAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "z".repeat(64)));
  t.check(`${odd !== null} ${odd?.sha256 === null}`, "true true");
});

// ## Detection is backend-independent
//
// An earlier version matched only `SHA256`/`SHA256E`, on the reasoning that other
// backends carry no content hash so there is nothing trustworthy to report. That
// was the wrong question. The job is *"are these the bytes, or a stand-in for
// them?"* — and a `SHA512E`, `WORM`, or `URL` pointer is just as much a stand-in.
// Missing one means serving it as an image, embedding it in a published page, or
// uploading it to a transcription API.
void test("An earlier version matched only SHA256/SHA256E, on the reasoning that other b...", async (t) => {
  // doctest:L98
  t.check(
    ["SHA512E-s5000--" + "b".repeat(128) + ".jpg", "WORM-s12-m456--file.jpg", "URL--http://example.com/x.jpg", "SHA1E-s12--" + "c".repeat(40) + ".jpg"]
      .map((k) => isAnnexPointer(bytes("/annex/objects/" + k)))
      .join(" "),
    "true true true true",
  );
});

// Hash metadata is optional enrichment, so a non-SHA256 backend reports its
// backend name and whatever size the key carries, rather than inventing a digest:
void test("Hash metadata is optional enrichment, so a non-SHA256 backend reports its bac...", async (t) => {
  // doctest:L108
  const worm = parseAnnexPointer(bytes("/annex/objects/WORM-s12-m456--file.jpg"));
  t.check(`${worm?.backend} size=${worm?.size} sha=${worm?.sha256}`, "WORM size=12 sha=null");
});

// A file too large to be a pointer is rejected without being decoded, so
// `isAnnexPointer` stays cheap on real content:
void test("A file too large to be a pointer is rejected without being decoded, so isAnne...", async (t) => {
  // doctest:L117
  t.check(isAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "a".repeat(64) + ".jpg" + " ".repeat(2000))), false);
});

// The absent-content message names the remedy, because the reader is usually an
// agent deciding what to do next:
void test("The absent-content message names the remedy, because the reader is usually an...", async (t) => {
  // doctest:L125
  const ptr = parseAnnexPointer(bytes(POINTER));
  t.check(ptr === null ? "unparsed" : describeAbsentContent(ptr, "photos.attach/photo-001.jpg"), "photos.attach/photo-001.jpg: content not present locally (300000 bytes, sha256 2ee2c7d49384…). Fetch it with `git annex get photos.attach/photo-001.jpg`.");
});
