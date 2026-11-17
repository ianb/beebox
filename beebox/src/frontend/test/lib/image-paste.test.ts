// # Unsupported-image message
//
// `unsupportedImageMessage` (`lib/image-paste.ts`) writes the toast shown when a
// picked file cannot be turned into a chat attachment.
//
// The message it replaced said only "Those files couldn't be added to the
// message". The encoder rejects whatever it cannot decode, so the format is the
// one fact the user needs. It once appeared only in a developer console line; a
// first-time user guessed their way to the answer from that log and noted their
// mother could not have. So the format is named, and so are the ones that work.
//
// HEIC is one of the formats that work: Safari decodes it, and other browsers
// decode it with libheif in a worker (`lib/heif/`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { unsupportedImageMessage } from "../../src/lib/image-paste.js";
import { HeifDecoderUnavailableError, HeifUnreadableError } from "../../src/lib/heif/decode.js";

/** A file that failed the native decode, unless `error` says otherwise. */
const failed = (name: string, type: string) => failedWith({ name, type, error: new Error("decode failed") });
const failedWith = ({ name, type, error }: { name: string; type: string; error: Error }) => ({ file: new File([], name, { type }), error });

// ## The format is named
void test("The format is named", async (t) => {
  t.check(unsupportedImageMessage([failed("scan.tiff", "image/tiff")]), "TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work.");
});

// ## Several of one format say it once; several formats are listed
//
// The set is deduplicated and sorted, so the message is stable no matter what
// order the picker handed the files over in.
void test("The set is deduplicated and sorted, so the message is stable no matter what o...", async (t) => {
  t.check(unsupportedImageMessage([failed("a.tiff", "image/tiff"), failed("b.tiff", "image/tiff")]), "TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work.");

  t.check(unsupportedImageMessage([failed("b.tiff", "image/tiff"), failed("a.bmp", "image/bmp")]), "BMP and TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work.");
});

// ## A missing type falls back to the extension
//
// A drag-and-drop from some file managers arrives with an empty `type`, which is
// still no reason to withhold the format — the name carries it.
void test("A drag-and-drop from some file managers arrives with an empty type, which is...", async (t) => {
  t.check(unsupportedImageMessage([failed("scan.TIFF", "")]), "TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work.");
});

// ## With nothing to go on, it says which files rather than inventing a format
void test("With nothing to go on, it says which files rather than inventing a format", async (t) => {
  t.check(unsupportedImageMessage([failed("clipboard", "")]), "That file can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work.");

  t.check(unsupportedImageMessage([failed("clipboard", ""), failed("other", "")]), "Those files can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work.");
});

// ## A file of an accepted format that failed to decode is damaged, not unsupported
//
// The message must not say JPEG is refused in the same breath as saying JPEG
// works. A file of a listed format that did not decode is unreadable or damaged.
void test("The message must not say JPEG is refused in the same breath as saying JPEG wo...", async (t) => {
  t.check(unsupportedImageMessage([failed("photo.jpg", "image/jpeg")]), "That image file can't be read; it may be damaged.");

  t.check(unsupportedImageMessage([failed("a.png", "image/png"), failed("b.heic", "image/heic")]), "Those image files can't be read; they may be damaged.");

  t.check(unsupportedImageMessage([failed("a.tiff", "image/tiff"), failed("b.jpg", "image/jpeg")]), "TIFF files can't be added: this browser can't read that format. JPEG, PNG, GIF, WebP and HEIC work. That image file can't be read; it may be damaged.");
});

// ## A HEIC that libheif could not read is damaged, whatever its type says
//
// A pasted HEIC arrives with an empty `type`. Its bytes routed it to libheif, so
// libheif's verdict decides, not the missing label.
void test("A HEIC that libheif could not read is damaged, whatever its type says", async (t) => {
  t.check(unsupportedImageMessage([failedWith({ name: "image", type: "", error: new HeifUnreadableError("bad") })]), "That image file can't be read; it may be damaged.");
});

// ## A HEIC reader that did not load says so, and says what to do
//
// The reader is a worker and a `.wasm` file fetched on first use. After a
// deploy, or offline, that fetch can fail; the file is fine and blaming it would
// be wrong.
void test("A HEIC reader that did not load says so, and says what to do", async (t) => {
  t.check(unsupportedImageMessage([failedWith({ name: "IMG_1139.HEIC", type: "image/heic", error: new HeifDecoderUnavailableError("404") })]), "HEIC files can't be added right now: the HEIC reader didn't load. Reload the page and try again.");
});

// ## An untyped file named for a listed format is damaged, not unsupported
//
// A HEIC with an empty `type` whose header is broken never reaches libheif.
// Its name still says HEIC, which the message lists as working, so it is
// reported as unreadable.
void test("An untyped file named for a listed format is damaged, not unsupported", async (t) => {
  t.check(unsupportedImageMessage([failed("IMG_4521.HEIC", "")]), "That image file can't be read; it may be damaged.");
});
