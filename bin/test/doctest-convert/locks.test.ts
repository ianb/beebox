// A driver lock names its owner; a lock whose owner is gone is taken over.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "tap";
import "agent-doctest/tap";
import { readLock, tryLock } from "../../doctest-convert/locks.ts";

void test("a live owner holds the lock; a dead owner's lock is taken over", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "doctest-convert-locks-"));
  const lock = join(dir, "slot-1.lock");
  const first = tryLock(lock, ["a.test.ts"]);
  const second = tryLock(lock, ["b.test.ts"]);
  // A pid far above any real one stands for an owner that has exited.
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 30, files: ["a.test.ts"] }));
  const takeover = tryLock(lock, ["c.test.ts"]);
  t.check({ first, second, takeover, owner: readLock(lock) }, { first: true, second: false, takeover: true, owner: { pid: process.pid, files: ["c.test.ts"] } });
});
