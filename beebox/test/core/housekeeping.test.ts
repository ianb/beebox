// # The `_tmp/` sweep
//
// `cleanupOldTmpUploads` runs from `bbx wakeup` housekeeping and removes
// `_tmp/` scratch a week old or more. Files flat at the top are aged by their
// own mtime. A chat message's directory (`_tmp/chat/<batch>/`) and any other
// scratch directory are aged by their newest file and removed whole, so one in
// use keeps every file. `_tmp/browser/` captures are aged one by one. Two
// directories own their lifecycle and are never touched: `capture-staging/`
// and `scan-quarantine/`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cleanupOldTmpUploads } from "../../src/core/housekeeping.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const DAY = 24 * 60 * 60 * 1000;
async function writeAged(file: string, ageDays: number) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "x");
  const at = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(file, at, at);
}
async function ageDir(dir: string, ageDays: number) {
  const at = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(dir, at, at);
}
async function exists(p: string) {
  try { await fs.access(p); return true; } catch (_e) { return false; }
}

void test("Stale _tmp scratch is removed; fresh scratch and owned directories stay", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const tmp = path.join(box.root, "_tmp");
  await writeAged(path.join(tmp, "old-flat.pdf"), 9);
  await writeAged(path.join(tmp, "fresh-flat.pdf"), 1);
  // A stale batch: every file over a week old.
  await writeAged(path.join(tmp, "chat/stale-batch-01/IMG_0001.jpg"), 10);
  await writeAged(path.join(tmp, "chat/stale-batch-01/notes.txt"), 8);
  await ageDir(path.join(tmp, "chat/stale-batch-01"), 10);
  // A batch whose directory is old but which received a file yesterday stays.
  await writeAged(path.join(tmp, "chat/live-batch-002/IMG_0002.jpg"), 12);
  await writeAged(path.join(tmp, "chat/live-batch-002/late.txt"), 1);
  await ageDir(path.join(tmp, "chat/live-batch-002"), 12);
  // Only files age a batch: a stale nested directory holding a fresh file keeps it.
  await writeAged(path.join(tmp, "chat/nested-batch-04/old.txt"), 10);
  await writeAged(path.join(tmp, "chat/nested-batch-04/sub/fresh.txt"), 1);
  await ageDir(path.join(tmp, "chat/nested-batch-04/sub"), 10);
  await ageDir(path.join(tmp, "chat/nested-batch-04"), 10);
  // An empty batch directory ages by its own mtime.
  await fs.mkdir(path.join(tmp, "chat/empty-batch-03"), { recursive: true });
  await ageDir(path.join(tmp, "chat/empty-batch-03"), 30);
  // Directories with their own lifecycle, old, are not ours to remove.
  await writeAged(path.join(tmp, "scan-quarantine/old.pdf"), 40);
  await ageDir(path.join(tmp, "scan-quarantine"), 40);
  await writeAged(path.join(tmp, "capture-staging/session-1/session.json"), 40);
  // Browser captures go one by one: the old capture, not the fresh one.
  await writeAged(path.join(tmp, "browser/card-old.png"), 9);
  await writeAged(path.join(tmp, "browser/card-fresh.png"), 1);
  // An agent's scratch directory goes whole once nothing in it is fresh; one
  // with a fresh file keeps its old files too.
  await writeAged(path.join(tmp, "full-audit/script.ts"), 20);
  await writeAged(path.join(tmp, "full-audit/out.txt"), 8);
  await writeAged(path.join(tmp, "reaction-tools/script.ts"), 20);
  await writeAged(path.join(tmp, "reaction-tools/out.txt"), 1);

  const log: string[] = [];
  t.check(await cleanupOldTmpUploads(box.root, (m) => log.push(m)), 5);

  t.check(
    await Promise.all([
      exists(path.join(tmp, "old-flat.pdf")),
      exists(path.join(tmp, "fresh-flat.pdf")),
      exists(path.join(tmp, "chat/stale-batch-01")),
      exists(path.join(tmp, "chat/live-batch-002/IMG_0002.jpg")),
      exists(path.join(tmp, "chat/empty-batch-03")),
      exists(path.join(tmp, "chat/nested-batch-04/sub/fresh.txt")),
      exists(path.join(tmp, "scan-quarantine/old.pdf")),
      exists(path.join(tmp, "capture-staging/session-1/session.json")),
      exists(path.join(tmp, "browser/card-old.png")),
      exists(path.join(tmp, "browser/card-fresh.png")),
      exists(path.join(tmp, "full-audit")),
      exists(path.join(tmp, "reaction-tools/script.ts")),
    ]),
    [
    false,
    true,
    false,
    true,
    false,
    true,
    true,
    true,
    false,
    true,
    false,
    true,
  ],
  );

  await t.checkText(log.filter((l) => l.includes("Removed:")).map((l) => l.trim().replace(/ \(\d+ days old\)/, "")).toSorted().join("\n"), `Removed: _tmp/browser/card-old.png
Removed: _tmp/chat/empty-batch-03/
Removed: _tmp/chat/stale-batch-01/
Removed: _tmp/full-audit/
Removed: _tmp/old-flat.pdf`);
});

// A walk fixture box a week ahead ages files by their real mtimes: nothing
// young is removed because the box clock is later.
void test("A walk fixture box with a clock offset ages _tmp files on the real clock", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => {
    await box.cleanup();
  });
  await box.write("_config/box.json", JSON.stringify({ timezone: "UTC", fakeNotifications: true }));
  await box.write(".beebox/clock-offset.json", JSON.stringify({ offsetMs: 14 * DAY, setAt: "2026-10-23T00:00:00Z" }));
  const tmp = path.join(box.root, "_tmp");
  await writeAged(path.join(tmp, "old-flat.pdf"), 9);
  await writeAged(path.join(tmp, "fresh-flat.pdf"), 1);

  t.check(await cleanupOldTmpUploads(box.root), 1);
  t.check([await exists(path.join(tmp, "old-flat.pdf")), await exists(path.join(tmp, "fresh-flat.pdf"))], [false, true]);
});
