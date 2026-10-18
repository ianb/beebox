// # Hashing an upload to disk
//
// `hashStreamToFile` writes a request body to a file while counting and hashing
// it. Both raw-upload routes (bulk-upload staging and scan-upload quarantine)
// rely on two promises it makes: it stops a body that runs past `maxBytes`
// before the whole body lands, and on any failure the partial file is gone, so
// the caller never cleans up after a throw.

import { t as tap, test } from "tap";
import "agent-doctest/tap";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashStreamToFile } from "../../src/lib/hash-stream-to-file.js";

const dir = mkdtempSync(join(tmpdir(), "hash-stream-"));
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const body = (...chunks: string[]) => Readable.from(chunks.map((c) => Buffer.from(c)));

tap.teardown(async () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// A body within the limit lands whole. The result reports the bytes actually
// received and their SHA-256, never a length the client claimed:
void test("A body within the limit lands whole.", async (t) => {
  // doctest:L26
  const result = await hashStreamToFile({ source: body("hello ", "world"), destPath: join(dir, "ok.bin"), maxBytes: 100 });
  await t.checkText(result.sha256 === sha256("hello world"), "true");

  // doctest:L30
  await t.checkText(result.size, "11");
});

// A body exactly at the limit is allowed; one byte more is refused with
// `StreamByteLimitError`, and the file is removed:
void test("A body exactly at the limit is allowed; one byte more is refused with StreamB...", async (t) => {
  // doctest:L38
  t.check(await hashStreamToFile({ source: body("12345"), destPath: join(dir, "exact.bin"), maxBytes: 5 }).then((r) => r.size), 5);

  // doctest:L41
  await t.checkThrows(async () => (await hashStreamToFile({ source: body("123456"), destPath: join(dir, "over.bin"), maxBytes: 5 })), "StreamByteLimitError: Stream exceeded the 5-byte limit");

  // doctest:L44
  t.check(existsSync(join(dir, "over.bin")), false);
});

// The removal has to wait for the write stream. A body that is over the limit
// in its first chunk fails before the stream has finished opening its file, and
// the stream creates the file after a too-early removal. Run that case many
// times, since it was a race (about one attempt in five left a file before the
// fix):
void test("The removal has to wait for the write stream.", async (t) => {
  // doctest:L55
  for (let i = 0; i < 100; i++) {
    await hashStreamToFile({ source: body("x".repeat(20)), destPath: join(dir, `race-${i}.bin`), maxBytes: 10 }).catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  t.check(readdirSync(dir).filter((name) => name.startsWith("race-")), []);
});

// A destination whose directory does not exist fails with the filesystem's
// error. The stream never opens there, and the failure still returns rather
// than waiting on a stream that will not close:
void test("A destination whose directory does not exist fails with the filesystem's error.", async (t) => {
  // doctest:L68
  await t.checkThrows(async () => (await hashStreamToFile({ source: body("data"), destPath: join(dir, "missing", "x.bin"), maxBytes: 100 })), "Error: ENOENT«*»");
});

// A failed write replaces nothing silently: an existing file at the destination
// is gone after the failure, so a caller never mistakes it for the new upload:
void test("A failed write replaces nothing silently:", async (t) => {
  // doctest:L76
  writeFileSync(join(dir, "old.bin"), "previous upload");
  t.check(await hashStreamToFile({ source: body("way too long"), destPath: join(dir, "old.bin"), maxBytes: 3 }).catch((e) => e.name), "StreamByteLimitError");

  // doctest:L80
  t.check(existsSync(join(dir, "old.bin")), false);
});
