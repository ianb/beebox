// # `writeFileAtomic` — crash-safe replace that preserves the target's mode
//
// `fs.writeFile` truncates in place, so a crash mid-write leaves a torn store;
// `writeFileAtomic` goes temp → fsync → rename so the target is always either
// the old complete file or the new one. Because the rename replaces the inode,
// it must also carry the old file's permissions forward — otherwise every save
// of a `0600` credential store would silently loosen it to the umask default
// (caught by cross-model review, 2026-08-01).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeFileAtomic, writeFileAtomicSync } from "../../src/lib/atomic-write.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
const target = path.join(dir, "store.json");

// ## Replaces content atomically and leaves no temp siblings
void test("Replaces content atomically and leaves no temp siblings", async (t) => {
  await writeFileAtomic(target, { content: '{"v":1}\n' });
  await writeFileAtomic(target, { content: '{"v":2}\n' });
  t.check(fs.readFileSync(target, "utf-8").trim(), '{"v":2}');
  t.check(fs.readdirSync(dir), ["store.json"]);
});

// ## An existing target's mode survives a rewrite without an explicit `mode`
void test("An existing target's mode survives a rewrite without an explicit `mode`", async (t) => {
  fs.chmodSync(target, 0o600);
  await writeFileAtomic(target, { content: '{"v":3}\n' });
  t.check(fs.statSync(target).mode & 0o777, 0o600);
});

// ## An explicit `mode` wins
void test("An explicit `mode` wins", async (t) => {
  await writeFileAtomic(target, { content: '{"v":4}\n', mode: 0o640 });
  t.check(fs.statSync(target).mode & 0o777, 0o640);
});

// ## A brand-new file gets the platform default (not a stat failure)
void test("A brand-new file gets the platform default (not a stat failure)", async (t) => {
  t.teardown(async () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const fresh = path.join(dir, "brand-new.json");
  await writeFileAtomic(fresh, { content: "x\n" });
  t.check(fs.existsSync(fresh), true);
});

// ## Bytes are written as given
//
// The image cache stores encoded images, so `content` may be bytes as well as
// text.
void test("Bytes are written as given", async (t) => {
  const bytesTarget = path.join(dir, "image.bin");
  await writeFileAtomic(bytesTarget, { content: Uint8Array.from([0, 255, 10, 128]) });
  t.check([...fs.readFileSync(bytesTarget)], [0, 255, 10, 128]);
});

// ## The mode is exact under a restrictive umask
//
// `open()` masks its mode with the umask, so a `0600` cache written under
// umask `0277` would come out `0400` without an explicit chmod.
void test("The mode is exact under a restrictive umask", async (t) => {
  const previous = process.umask(0o277);
  t.teardown(() => { process.umask(previous); });
  const cache = path.join(dir, "cache.json");
  await writeFileAtomic(cache, { content: "{}\n", mode: 0o600 });
  t.check(fs.statSync(cache).mode & 0o777, 0o600);
});

// ## The sync twin follows the same rules
//
// Sync stores (token stores, the auth file, the Tailscale exposure file) get
// the same replace, the same exact mode, and the same mode preservation.
void test("writeFileAtomicSync replaces, sets an explicit mode, and keeps an existing one", async (t) => {
  const store = path.join(dir, "sync-store.json");
  writeFileAtomicSync(store, { content: '{"v":1}\n', mode: 0o600 });
  writeFileAtomicSync(store, { content: '{"v":2}\n' });
  t.check(fs.readFileSync(store, "utf-8"), '{"v":2}\n');
  t.check(fs.statSync(store).mode & 0o777, 0o600);
  t.check(fs.readdirSync(dir).filter((name) => name.startsWith("sync-store")), ["sync-store.json"]);
});
