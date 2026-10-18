// # Settle gate and file identity
//
// Two independent defenses against a scanner writing a file out from under the
// uploader: the **settle gate** (skip files touched too recently) before the
// first hash, and **identity snapshot + restat-before-disposition** (see
// run-target.doctest.md) after it.

import { test } from "tap";
import "agent-doctest/tap";
import { utimes, writeFile } from "node:fs/promises";
import { isSettled, SETTLE_WINDOW_MS } from "../../src/cli/settle.js";
import { identityEquals, snapshotIdentity } from "../../src/cli/identity.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("settle");

// A file just written is not settled — its mtime is within the 10s window:
void test("A file just written is not settled — its mtime is within the 10s window:", async (t) => {
  // doctest:L21
  const fresh = `${dir}/fresh.pdf`;
  await writeFile(fresh, "scan bytes");
  t.check(await isSettled(fresh, Date.now()), false);
});

// A file whose mtime is safely in the past IS settled:
void test("A file whose mtime is safely in the past IS settled:", async (t) => {
  // doctest:L30
  const old = `${dir}/old.pdf`;
  await writeFile(old, "scan bytes");
  const oldMtime = new Date(Date.now() - SETTLE_WINDOW_MS - 1000);
  await utimes(old, oldMtime, oldMtime);
  t.check(await isSettled(old, Date.now()), true);
});

// The boundary is inclusive of "now minus the window" — exactly at the window
// edge counts as settled (`>=`, not `>`):
void test("The boundary is inclusive of \"now minus the window\" — exactly at the window e...", async (t) => {
  // doctest:L42
  const boundary = `${dir}/boundary.pdf`;
  await writeFile(boundary, "scan bytes");
  const now = Date.now();
  const boundaryMtime = new Date(now - SETTLE_WINDOW_MS);
  await utimes(boundary, boundaryMtime, boundaryMtime);
  t.check(await isSettled(boundary, now), true);
});

// `snapshotIdentity` captures device, inode, size, and nanosecond mtime.
// Re-snapshotting an untouched file yields an identical snapshot:
void test("snapshotIdentity captures device, inode, size, and nanosecond mtime.", async (t) => {
  t.teardown(async () => {
    try {
      await removeTmpDir(dir);
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L55
  const stable = `${dir}/stable.pdf`;
  await writeFile(stable, "unchanged bytes");
  const first = await snapshotIdentity(stable);
  const second = await snapshotIdentity(stable);
  t.check(identityEquals(first, second), true);

  // Appending to the file (same path, different bytes) changes its identity —
  // this is the signal `run-target.ts` checks before disposition:

  // doctest:L67
  const before = await snapshotIdentity(stable);
  await writeFile(stable, "unchanged bytes and then some more");
  const after = await snapshotIdentity(stable);
  t.check(identityEquals(before, after), false);
});
