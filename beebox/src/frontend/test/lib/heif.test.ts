// # HEIF decoding
//
// Chrome and Firefox cannot decode a HEIC, the iPhone's photo format. The
// composer recognizes one by its header (`lib/heif/sniff.ts`) and decodes it
// with libheif (`lib/heif/decoder/libheif.ts`), which the browser runs in a worker.
// These tests run the same decode in Node against real HEIC files.
//
// The fixtures are 96×48: red on the left half, blue on the right, made with
// macOS `sips -s format heic`. `red-blue-rotated.heic` is the same file with its
// `irot` box set to 90° counter-clockwise, which is how a camera can store a
// portrait photo without moving pixels.

import { readFileSync } from "node:fs";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import libheifFactory from "libheif-js/libheif-wasm/libheif.js";
import { isHeifHeader } from "../../src/lib/heif/sniff.js";
import { decodeHeifPrimary, loadLibheif, type DecodedPixels } from "../../src/lib/heif/decoder/libheif.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../test/fixtures/heif/${name}`, import.meta.url)));
/** An ISO-BMFF header: 4-byte size, `ftyp`, then `rest` (the brand, when long enough). */
const ftyp = (rest: string) => new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode(`ftyp${rest}`)]);

/** "red", "blue", or the raw RGB, at (x, y). Lossy HEVC shifts channels a little. */
function colorAt(image: DecodedPixels, [x, y]: readonly [number, number]): string {
  const i = (y * image.width + x) * 4;
  const [r = 0, g = 0, b = 0] = image.pixels.subarray(i, i + 3);
  if (r > 200 && g < 60 && b < 60) return "red";
  if (b > 200 && r < 60 && g < 60) return "blue";
  return `rgb(${r},${g},${b})`;
}

// ## The header decides
//
// A pasted image often has no `type`, so the bytes are the evidence: an ISO-BMFF
// `ftyp` box whose major brand is a HEIF brand.
void test("The header decides", async (t) => {
  t.check(isHeifHeader(fixture("red-blue.heic")), true);
  t.check(isHeifHeader(ftyp("heic")), true);
  t.check(isHeifHeader(ftyp("mif1")), true);
  // An MP4, a JPEG, and a header too short to hold a brand.
  t.check(isHeifHeader(ftyp("isom")), false);
  t.check(isHeifHeader(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1])), false);
  t.check(isHeifHeader(ftyp("")), false);
});

// In Node the glue finds `libheif.wasm` beside itself; no URL is needed.
const libheif = await loadLibheif(libheifFactory, {});

// ## A HEIC decodes to its pixels
void test("A HEIC decodes to its pixels", async (t) => {
  const image = decodeHeifPrimary(libheif, fixture("red-blue.heic"));
  t.check([image.width, image.height, colorAt(image, [10, 24]), colorAt(image, [86, 24])], [96, 48, "red", "blue"]);
});

// ## The stored rotation is applied
//
// Rotated 90° counter-clockwise, the left (red) half ends up at the bottom.
void test("Rotated 90° counter-clockwise, the left (red) half ends up at the bottom.", async (t) => {
  const image = decodeHeifPrimary(libheif, fixture("red-blue-rotated.heic"));
  t.check([image.width, image.height, colorAt(image, [24, 10]), colorAt(image, [24, 86])], [48, 96, "blue", "red"]);
});

// ## Bytes that are not a HEIF image are refused, not decoded as blank
//
// libheif-js reports a parse failure only on `console.log` and returns no
// images; the decode turns that into an error.
void test("Bytes that are not a HEIF image are refused, not decoded as blank", async (t) => {
  const truncated = fixture("red-blue.heic").subarray(0, 64);
  const logged = t.capture(console, "log");
  await t.checkThrows(() => decodeHeifPrimary(libheif, truncated), "HeifDecodeError: No image in HEIF file");
  t.check(logged().map((call) => call.args), [["Could not parse HEIF file", "Invalid input: Unspecified: Insufficient input data"]]);
});

// ## A trap inside libheif's decode throws to the caller
//
// libheif-js's own `display()` runs the decode in a detached async callback, so
// a WebAssembly trap there was an unhandled rejection and the composer's
// placeholder waited forever. The decode is called directly, so it throws here.
void test("A trap inside libheif's decode throws to the caller", async (t) => {
  const trapping = {
    ...libheif,
    heif_js_decode_image2: () => {
      throw new WebAssembly.RuntimeError("unreachable");
    },
  };
  await t.checkThrows(() => decodeHeifPrimary(trapping, fixture("red-blue.heic")), "RuntimeError: unreachable");
});

// ## Loading waits for the runtime, and a failed start is an error
//
// The factory returns the module before its WebAssembly runs; `loadLibheif`
// resolves only on `onRuntimeInitialized`, and rejects on `onAbort` (a `.wasm`
// that failed to fetch or compile).
void test("Loading waits for the runtime, and a failed start is an error", async (t) => {
  const events: string[] = [];
  const late = loadLibheif((options) => {
    setTimeout(() => {
      events.push("initialized");
      options.onRuntimeInitialized();
    }, 10);
    return libheif;
  }, {}).then(() => events.push("loaded"));
  await late;
  t.check(events, ["initialized", "loaded"]);

  await t.checkThrows(() => loadLibheif((options) => {
    options.onAbort("both async and sync fetching of the wasm failed");
    return {};
  }, {}), "LibheifStartError: both async and sync fetching of the wasm failed");
});
