// # Abandoned `.git/index.lock`
//
// `git` removes its index lock on normal exit, on error, and on SIGTERM. It
// cannot after SIGKILL — and the file it leaves fails every writer in the box
// with the same message live contention produces, so the condition reads as
// transient bad luck forever.
//
// `git-stale-lock.ts` tells the two apart and removes the abandoned one. The test
// that matters most is the negative: it must not remove a lock something is
// actually using, because that makes the holder's commit fail.

import { test } from "tap";
import "agent-doctest/tap";
import { open, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as childProcess from "node:child_process";
import { promisify } from "node:util";
import type { Test } from "tap";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { inspectIndexLock, INDEX_LOCK_STALE_MS, formatAge } from "../../src/lib/git-stale-lock.js";

const execFileAsync = promisify(childProcess.execFile);

// On macOS the holder probe is `lsof`, which by default scans every process on
// the machine. In a loaded full suite that scan outran its 5s budget, and the
// probe then answered `unknown-holder` — correctly, but not what these
// sections are about. The only process that can hold a lock this file plants
// is this one, so the real `lsof` is narrowed to it with `-a -p`.
function lsofThisProcess(args: string[], options: childProcess.ExecFileOptions) {
  const at = args.indexOf("--");
  if (at === -1) throw new Error(`unexpected lsof arguments: ${args.join(" ")}`);
  const narrowed = [...args.slice(0, at), "-a", "-p", String(process.pid), ...args.slice(at)];
  return execFileAsync("lsof", narrowed, options);
}

// What `execFile` rejects with when its timeout kills the child.
function lsofTimedOut() {
  return Promise.reject(Object.assign(new Error("Command failed: lsof"), {
    killed: true, signal: "SIGTERM", code: null, stdout: "", stderr: "",
  }));
}

// Import `modulePath` with `lsof` calls routed to `lsof`; every other command
// runs for real.
type LsofCall = (args: string[], options: childProcess.ExecFileOptions) => Promise<unknown>;

function withLsof(t: Test, { modulePath, lsof }: { modulePath: string; lsof: LsofCall }) {
  const execFile = Object.assign(
    (...callArgs: Parameters<typeof childProcess.execFile>) => childProcess.execFile(...callArgs),
    {
      [promisify.custom]: (...[file, args, options]: [string, string[], childProcess.ExecFileOptions]) =>
        file === "lsof" ? lsof(args, options) : execFileAsync(file, args, options),
    },
  );
  return t.mockImport(modulePath, { "node:child_process": { ...childProcess, execFile } });
}

const STALE_LOCK = "../../src/lib/git-stale-lock.ts";

const lockPathOf = (box: TmpBox) => join(box.root, ".git", "index.lock");

// Write a lock file and backdate it, standing in for one a killed git left
// behind `ageMs` ago.
async function plantLock(box: TmpBox, ageMs: number) {
  const lockPath = lockPathOf(box);
  await writeFile(lockPath, "partially written index\n");
  const when = new Date(Date.now() - ageMs);
  await utimes(lockPath, when, when);
  return lockPath;
}

// ## No lock, and a lock too young to judge
//
// A repository with nothing in the way reports `absent`:
void test("A repository with nothing in the way reports absent:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L76
  const { recoverStaleIndexLock } = await withLsof(t, { modulePath: STALE_LOCK, lsof: lsofThisProcess });
  const box = await makeTmpBox({ git: true });
  t.check((await inspectIndexLock(box.root)).state, "absent");

  // A lock that appeared moments ago is ordinary contention — some writer has the
  // index right now — and gets no verdict beyond `fresh`:

  // doctest:L86
  await plantLock(box, 1000);
  t.check((await inspectIndexLock(box.root)).state, "fresh");

  // `recoverStaleIndexLock` leaves it exactly where it is. This is the common case
  // on a busy box, and removing here would break whoever is mid-commit:

  // doctest:L95
  const kept = await recoverStaleIndexLock(box.root);
  t.check([kept.state, existsSync(lockPathOf(box))].join(" "), "fresh true");
});

// ## An old, unheld lock is abandoned and gets removed
//
// Backdated well past the staleness window, with no process holding it — the
// condition a SIGKILLed `git` leaves behind:
void test("Backdated well past the staleness window, with no process holding it — the co...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L110
  const { inspectIndexLock: inspectWithLsof, recoverStaleIndexLock } = await withLsof(t, { modulePath: STALE_LOCK, lsof: lsofThisProcess });
  const box = await makeTmpBox({ git: true });
  await plantLock(box, INDEX_LOCK_STALE_MS + 60_000);

  // doctest:L114
  const verdict = await inspectWithLsof(box.root);
  t.check(verdict.state, "stale");

  // Removal is announced rather than silent: a lock only becomes abandoned because
  // something was killed mid-write, which is worth a human's attention even though
  // the box recovers on its own.

  // doctest:L124
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.map(String).join(" ")); };
  const recovered = await recoverStaleIndexLock(box.root);
  console.error = realError;

  // doctest:L130
  t.check([recovered.state, existsSync(lockPathOf(box))].join(" "), "stale false");

  // doctest:L135
  await t.checkText(logged.length === 1 && logged[0]?.includes("removed an abandoned"), "true");
});

// ## An old lock someone still has open is NOT removed
//
// Age alone is not enough. A process holding the file open is doing something
// with it whatever its mtime says, and deleting it under that process makes its
// final `rename()` fail — so an open descriptor vetoes removal outright:
void test("Age alone is not enough.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L150
  const { inspectIndexLock: inspectWithLsof, recoverStaleIndexLock } = await withLsof(t, { modulePath: STALE_LOCK, lsof: lsofThisProcess });
  const box = await makeTmpBox({ git: true });
  const lockPath = await plantLock(box, INDEX_LOCK_STALE_MS + 60 * 60_000);

  // doctest:L154
  const handle = await open(lockPath, "r");
  const held = await inspectWithLsof(box.root);
  t.check(held.state, "held");

  // doctest:L161
  const refused = await recoverStaleIndexLock(box.root);
  t.check([refused.state, existsSync(lockPath)].join(" "), "held true");

  // Once the holder lets go, the same lock is recoverable — nothing about the
  // refusal is sticky:

  // doctest:L170
  await handle.close();
  const now = await recoverStaleIndexLock(box.root);
  t.check([now.state, existsSync(lockPath)].join(" "), "stale false");
});

// ## A probe that cannot answer removes nothing
//
// When the holder probe fails — here `lsof` killed by its timeout, which is what
// a heavily loaded machine produces — the verdict is `unknown-holder`, not
// "nobody holds it". An old lock the probe could not check stays where it is:
void test("When the holder probe fails — here lsof killed by its timeout, which is what...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L187
  const { inspectIndexLock: inspectWithLsof, recoverStaleIndexLock } = await withLsof(t, { modulePath: STALE_LOCK, lsof: lsofTimedOut });
  const box = await makeTmpBox({ git: true });
  const lockPath = await plantLock(box, INDEX_LOCK_STALE_MS + 60_000);

  // doctest:L191
  t.check((await inspectWithLsof(box.root)).state, "unknown-holder");

  // doctest:L196
  const left = await recoverStaleIndexLock(box.root);
  t.check([left.state, existsSync(lockPath)].join(" "), "unknown-holder true");
});

// ## A lock being actively written survives the settle window
//
// The holder probe can miss a live `git`: git closes the lock's descriptor in
// some flows and keeps the lock as a NAME until it renames it into place. The
// confirming re-stat is what covers that gap — a lock whose mtime moves during
// the settle window is being written, so it comes back out the far side as
// `fresh` and is left alone, even though it looked unheld and old a moment
// earlier.
void test("The holder probe can miss a live git:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L215
  const { recoverStaleIndexLock } = await withLsof(t, { modulePath: STALE_LOCK, lsof: lsofThisProcess });
  const box = await makeTmpBox({ git: true });
  const lockPath = await plantLock(box, INDEX_LOCK_STALE_MS + 60_000);

  // doctest:L219
  // Touch it mid-settle, the way a writer flushing the index would.
  const toucher = setTimeout(() => {
    void writeFile(lockPath, "more index bytes\n");
  }, 500);
  const verdict = await recoverStaleIndexLock(box.root);
  clearTimeout(toucher);

  // doctest:L226
  t.check([verdict.state, existsSync(lockPath)].join(" "), "fresh true");
});

// ## A commit recovers through it
//
// The payoff. Every index mutator in `git.ts` reaches
// `recoverStaleIndexLock` on its first `index.lock` failure, so a box that a
// crashed git left wedged heals on the next write instead of failing every writer
// until a human intervenes:
void test("The payoff.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L242
  const { stageAndCommitPaths } = await withLsof(t, { modulePath: "../../src/lib/git/core/operations.ts", lsof: lsofThisProcess });
  const box = await makeTmpBox({ git: true });
  await plantLock(box, INDEX_LOCK_STALE_MS + 60_000);
  await box.write("after-the-crash.md", "written while the abandoned lock stood\n");

  // doctest:L247
  const realError = console.error;
  console.error = () => {};
  const hash = await stageAndCommitPaths(box.root, {
    paths: ["after-the-crash.md"],
    message: "commit past an abandoned index lock",
  });
  console.error = realError;

  // doctest:L255
  t.check([typeof hash === "string" && hash.length > 0, existsSync(lockPathOf(box))].join(" "), "true false");
});

// ## Ages read as ages
//
// The age appears in a health message and a log line, so it is rendered at the
// scale a reader thinks in rather than as milliseconds:
void test("The age appears in a health message and a log line, so it is rendered at the...", async (t) => {
  // doctest:L269
  t.check([formatAge(4 * 60_000), formatAge(3 * 3_600_000), formatAge(5 * 86_400_000), formatAge(null)].join(" "), "4m 3h 5d unknown age");
});

// ## Not a repository
//
// A directory with no repository has no index to lock, so there is nothing to
// report and nothing to remove:
void test("A directory with no repository has no index to lock, so there is nothing to r...", async (t) => {
  // doctest:L279
  const status = await inspectIndexLock("/");
  t.check([status.state, String(status.lockPath)].join(" "), "absent null");
});
