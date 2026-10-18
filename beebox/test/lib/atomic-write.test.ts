// # `writeFileAtomic` — crash-safe replace that preserves the target's mode
//
// `fs.writeFile` truncates in place, so a crash mid-write leaves a torn store;
// `writeFileAtomic` goes temp → fsync → rename so the target is always either
// the old complete file or the new one. Because the rename replaces the inode,
// it must also carry the old file's permissions forward — otherwise every save
// of a `0600` credential store would silently loosen it to the umask default
// (caught by cross-model review, 2026-08-01).

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeFileAtomic } from "../../src/lib/atomic-write.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
const target = path.join(dir, "store.json");

// ## Replaces content atomically and leaves no temp siblings
void test("Replaces content atomically and leaves no temp siblings", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L23
  await writeFileAtomic(target, { content: '{"v":1}\n' });
  await writeFileAtomic(target, { content: '{"v":2}\n' });
  print(fs.readFileSync(target, "utf-8").trim());
  await t.checkText(out.with(print(`siblings: ${fs.readdirSync(dir).join(",")}`)), `{"v":2}
siblings: store.json`);
});

// ## An existing target's mode survives a rewrite without an explicit `mode`
void test("An existing target's mode survives a rewrite without an explicit `mode`", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L34
  fs.chmodSync(target, 0o600);
  await writeFileAtomic(target, { content: '{"v":3}\n' });
  await t.checkText(out.with(print((fs.statSync(target).mode & 0o777).toString(8))), "600");
});

// ## An explicit `mode` wins
void test("An explicit `mode` wins", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L43
  await writeFileAtomic(target, { content: '{"v":4}\n', mode: 0o640 });
  await t.checkText(out.with(print((fs.statSync(target).mode & 0o777).toString(8))), "640");
});

// ## A brand-new file gets the platform default (not a stat failure)
void test("A brand-new file gets the platform default (not a stat failure)", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L51
  const fresh = path.join(dir, "brand-new.json");
  await writeFileAtomic(fresh, { content: "x\n" });
  await t.checkText(out.with(print(fs.existsSync(fresh))), "true");
});
