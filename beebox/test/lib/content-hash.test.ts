// # Content hashes
//
// `sha256Hex` is the full SHA-256 as lowercase hex (template stock hashes,
// triage evidence digests, the test fingerprint); `contentHash` is its first
// 16 chars for change detection. See `src/lib/content-hash.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { contentHash, sha256Hex } from "../../src/lib/content-hash.js";

// The FIPS 180-2 test vector for "abc"; bytes and their UTF-8 string agree.
void test("sha256Hex matches the standard vector for text and bytes; contentHash is its prefix", async (t) => {
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  t.check(sha256Hex("abc"), abc);
  t.check(sha256Hex(Buffer.from("abc", "utf-8")), abc);
  t.check(contentHash("abc"), "ba7816bf8f01cfea");
});
