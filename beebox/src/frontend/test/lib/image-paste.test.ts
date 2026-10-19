// # Unsupported-image message
//
// `unsupportedImageMessage` (`lib/image-paste.ts`) writes the toast shown when a
// picked file cannot be turned into a chat attachment.
//
// The message it replaced said only "Those files couldn't be added to the
// message". The encoder rejects whatever the browser cannot decode — in practice
// a HEIC straight off an iPhone — so the format was the one fact the user needed
// and the only place it appeared was a developer console line. A first-time user
// guessed their way to the answer from that log and noted their mother could not
// have. So the format is named, and so are the ones that work.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { unsupportedImageMessage } from "../../src/lib/image-paste.js";

const file = (name: string, type: string) => new File([], name, { type });

// ## The format is named
void test("The format is named", async (t) => {
  t.check(unsupportedImageMessage([file("IMG_1139.HEIC", "image/heic")]), "HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.");
});

// ## Several of one format say it once; several formats are listed
//
// The set is deduplicated and sorted, so the message is stable no matter what
// order the picker handed the files over in.
void test("The set is deduplicated and sorted, so the message is stable no matter what o...", async (t) => {
  t.check(unsupportedImageMessage([file("a.heic", "image/heic"), file("b.heic", "image/heic")]), "HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.");

  t.check(unsupportedImageMessage([file("b.tiff", "image/tiff"), file("a.heic", "image/heic")]), "HEIC and TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.");
});

// ## A missing type falls back to the extension
//
// A drag-and-drop from some file managers arrives with an empty `type`, which is
// still no reason to withhold the format — the name carries it.
void test("A drag-and-drop from some file managers arrives with an empty type, which is...", async (t) => {
  t.check(unsupportedImageMessage([file("scan.HEIC", "")]), "HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.");
});

// ## With nothing to go on, it says which files rather than inventing a format
void test("With nothing to go on, it says which files rather than inventing a format", async (t) => {
  t.check(unsupportedImageMessage([file("clipboard", "")]), "That file can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.");

  t.check(unsupportedImageMessage([file("clipboard", ""), file("other", "")]), "Those files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work.");
});

// ## A file of an accepted format that failed to decode is damaged, not unsupported
//
// The message must not say JPEG is refused in the same breath as saying JPEG
// works. A JPEG, PNG, GIF or WebP that did not decode is unreadable or damaged.
void test("The message must not say JPEG is refused in the same breath as saying JPEG wo...", async (t) => {
  t.check(unsupportedImageMessage([file("photo.jpg", "image/jpeg")]), "That image file can't be read; it may be damaged.");

  t.check(unsupportedImageMessage([file("a.png", "image/png"), file("b.webp", "image/webp")]), "Those image files can't be read; they may be damaged.");

  t.check(unsupportedImageMessage([file("a.heic", "image/heic"), file("b.jpg", "image/jpeg")]), "HEIC files can't be added: this browser can't read that format. JPEG, PNG, GIF and WebP work. That image file can't be read; it may be damaged.");
});
