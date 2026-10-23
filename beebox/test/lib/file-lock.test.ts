// # File Lock
//
// Machine-local cross-process file lock, implemented on `proper-lockfile`.
// Mutual exclusion is a single atomic `mkdir` of a guard directory
// (`<path>.guard`); a diagnostic sidecar file at `<path>` carries the holder's
// identity but never participates in the acquire decision. Stale/crashed holders
// are reclaimed via `proper-lockfile`'s mtime freshness — 5 min by default, 15 s
// for request-scoped locks — never by an unconditional unlink-by-path.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, anything, capture, instanceOf, isoDate, str, unordered } from "@ianbicking/tap-check/check";
import {
  acquireLock,
  releaseLock,
  inspectLock,
  forceAcquireLock,
  scanLocks,
  withFileLock,
  requestScopedLock,
  LOCK_STALE_MS,
  LockHeldError,
} from "../../src/lib/file-lock.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";

// The holder record `acquireLock` returns and `inspectLock` reads back.
function heldBy(metadata: Record<string, unknown>) {
  return { pid: process.pid, hostname: os.hostname(), acquiredAt: isoDate(), metadata };
}

// What `acquireLock` throws when `holder` holds the lock.
function heldError(pid: number, metadata: Record<string, unknown>) {
  return {
    name: "LockHeldError",
    message: str`Lock held by pid ${String(pid)} on ${os.hostname()} (acquired ${any(String)})`,
    holder: { pid, hostname: os.hostname(), acquiredAt: isoDate(), metadata },
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The default profile's stale window is 5 min; "well past stale" backdates a
// guard dir's mtime beyond it to simulate a crashed holder.
function backdatedPast() {
  return new Date(Date.now() - LOCK_STALE_MS.default - 60 * 1000);
}

const PACKAGE_ROOT = join(import.meta.dirname, "../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/helpers/file-lock-child.ts");

// Spawn a real child process that takes `lockPath` (request profile) and holds
// it, then SIGKILL it mid-hold — a genuine crashed holder, guard dir and all.
async function crashedHolder(lockPath: string) {
  const child = spawn(process.execPath, ["--import", "tsx", CHILD_SCRIPT, lockPath], {
    cwd: PACKAGE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("acquired")) resolve(); });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`child exited early (${code}): ${stderr}`)));
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

// Write a diagnostic sidecar as if another process had published it.
function foreignSidecar(who: string, pid: number) {
  return JSON.stringify({
    pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    metadata: { who },
  }) + "\n";
}

// ## acquireLock / releaseLock
//
// ### Acquire creates the guard dir + diagnostic sidecar with our metadata
void test("Acquire creates the guard dir + diagnostic sidecar with our metadata", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  const holder = await acquireLock(path, { triggeredBy: "manual" });
  t.check(holder, heldBy({ triggeredBy: "manual" }));
  t.check(
    {
      guardDir: await fs.stat(path + ".guard").then((s) => s.isDirectory()).catch(() => false),
      sidecarFile: await fs.access(path).then(() => true).catch(() => false),
    },
    { guardDir: true, sidecarFile: true },
  );
});

// ### Release removes both the guard dir and the sidecar
void test("Release removes both the guard dir and the sidecar", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await acquireLock(path, {});
  await releaseLock(path);
  t.check(
    {
      guard: await fs.access(path + ".guard").then(() => "exists").catch(() => "gone"),
      sidecar: await fs.access(path).then(() => "exists").catch(() => "gone"),
    },
    { guard: "gone", sidecar: "gone" },
  );
});

// ### Release is idempotent
//
// Releasing when not held, releasing twice — both fine.
void test("Releasing when not held, releasing twice — both fine.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await releaseLock(path);
  await acquireLock(path, {});
  await releaseLock(path);
  await releaseLock(path);
  t.check("ok", "ok");
});

// ## Concurrency
//
// ### Acquiring a held lock throws LockHeldError
void test("Acquiring a held lock throws LockHeldError", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await acquireLock(path, { who: "first" });
  const caught = await acquireLock(path, { who: "second" }).then(() => null, (e) => e);
  t.check(caught, instanceOf(LockHeldError));
  t.check(caught, heldError(process.pid, { who: "first" }));
});

// ### A live foreign holder (guard dir owned by another process) is not stolen
//
// A fresh guard directory with no in-process release is exactly what another live
// process's `proper-lockfile` would leave. We must see it as held.
void test("A fresh guard directory with no in-process release is exactly what another li...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await fs.mkdir(path + ".guard");
  await fs.writeFile(path, foreignSidecar("other-proc", 4242));

  const caught = await acquireLock(path, { who: "us" }).then(() => null, (e) => e);
  t.check(caught, instanceOf(LockHeldError));
  t.check(caught, heldError(4242, { who: "other-proc" }));
});

// ### Many parallel acquisitions: exactly one wins, the rest see LockHeldError
//
// The guard-dir `mkdir` is atomic, so contention on one path can never
// double-acquire. The winner stays alive holding the lock; every other attempt
// rejects with `LockHeldError`.
void test("The guard-dir mkdir is atomic, so contention on one path can never double-acq...", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_unused, i) => acquireLock(path, { who: i })),
  );
  // A loser can read the winner's holder before its sidecar is written (pid -1,
  // no metadata) or after, so its holder varies.
  const winner = capture(any(Number).int().between(0, 39));
  const loser = {
    status: "rejected" as const,
    reason: {
      name: "LockHeldError",
      message: str`Lock held by pid ${any(String).matches(/^-?\d+$/)} on ${os.hostname()} (acquired ${any(String)})`,
      holder: anything(),
    },
  };
  t.check(
    results,
    unordered([{ status: "fulfilled", value: heldBy({ who: winner }) }, ...Array.from({ length: 39 }, () => loser)]),
  );
  // The losers' reasons are real LockHeldError instances, not look-alikes.
  t.check(
    results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    Array.from({ length: 39 }, () => instanceOf(LockHeldError)),
  );
});

// ### The reclaim/release handoff yields exactly one holder (the race the old code lost)
//
// This is the scenario the previous home-grown lock failed: a holder releases
// while contenders are mid-retry, and the reclaim must hand the lock to *exactly
// one* of them — never two. The winner holds; the losers keep seeing
// `LockHeldError` until they give up. If the release-then-reacquire path could
// double-acquire, more than one contender would have gotten in.
void test("This is the scenario the previous home-grown lock failed:", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path); // release whichever contender is now holding `path`
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await acquireLock(path, { who: "A" });

  let acquiredCount = 0;
  const contend = async (id: string) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await acquireLock(path, { who: id });
        acquiredCount++;
        return; // won it — HOLD (do not release), so no one else may acquire
      } catch (e) {
        if (!(e instanceof LockHeldError)) throw e;
        await delay(15);
      }
    }
  };

  const contenders = Array.from({ length: 5 }, (_unused, i) => contend(`c${i}`));
  await delay(60); // let them all bounce off A's held lock
  await releaseLock(path); // A steps aside — exactly one contender may now win
  await Promise.all(contenders);
  t.check(acquiredCount, 1);
});

// ## Stale / crash recovery
//
// ### A crashed holder (stale guard mtime) is reclaimed on the next acquire
//
// A SIGKILL'd process leaves its guard directory behind with a frozen mtime.
// Once that mtime is older than the stale window, the next acquirer reclaims it —
// no PID liveness, no unlink-by-path, just `proper-lockfile`'s mtime steal.
void test("A SIGKILL'd process leaves its guard directory behind with a frozen mtime.", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  const guard = path + ".guard";
  await fs.mkdir(guard);
  const past = backdatedPast();
  await fs.utimes(guard, past, past);
  await fs.writeFile(path, foreignSidecar("ghost", 999999));

  const holder = await acquireLock(path, { who: "us" });
  t.check(holder, heldBy({ who: "us" }));
});

// ## Stale profiles
//
// Request-scoped locks (mobile device store, local users, connector token
// stores, ...) declare the `request` profile via `requestScopedLock(path)`, which
// shortens the stale window from 5 min to 15 s so a crashed holder can't wedge an
// HTTP path for minutes. Locks passed as a plain path keep the default profile.
//
// ### A SIGKILL'd request-scoped holder recovers within the request stale window
//
// A real child process takes the lock and is killed mid-hold, leaving its guard
// directory behind. Immediately afterwards the lock still reads as held — callers
// with a ~5 s retry budget fail *loud* rather than block, which is by design. Once
// the request stale window has elapsed the next acquirer reclaims it.
//
// Rather than sleeping 15 s, we backdate the dead holder's guard mtime to
// simulate that much time passing — and check the same instant through both
// profiles: the default profile (5 min) still sees a live holder, the request
// profile reclaims.
void test("Request-scoped locks (mobile device store, local users, connector token store...", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(lockPath);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const lockPath = join(box.root, "devices.lock");
  await crashedHolder(lockPath);

  const justAfter = await acquireLock(requestScopedLock(lockPath), { who: "b" }).then(() => "acquired", (e) => e.name);
  t.check(justAfter, "LockHeldError");

  const aged = new Date(Date.now() - LOCK_STALE_MS.request - 1000);
  await fs.utimes(lockPath + ".guard", aged, aged);

  const asDefault = await acquireLock(lockPath, { who: "d" }).then(() => "acquired", (e) => e.name);
  t.check(asDefault, "LockHeldError");
  const holder = await acquireLock(requestScopedLock(lockPath), { who: "recovered" });
  t.check(holder, heldBy({ who: "recovered" }));
});

// ### Diagnostics use the same profile as acquisition
//
// `inspectLock` must not disagree with `acquireLock` about staleness: at +16s the
// same dead holder reads as gone through the request profile and as live through
// the default one.
void test("inspectLock must not disagree with acquireLock about staleness:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const lockPath = join(box.root, "devices.lock");
  await crashedHolder(lockPath);
  const aged = new Date(Date.now() - LOCK_STALE_MS.request - 1000);
  await fs.utimes(lockPath + ".guard", aged, aged);

  t.check(await inspectLock(requestScopedLock(lockPath)), null);
  // The holder is the killed child process, so its pid is not ours.
  t.check(await inspectLock(lockPath), { ...heldBy({ purpose: "file-lock-test-child" }), pid: any(Number).int() });
});

// ### releaseLock never deletes a foreign holder's lock
//
// Releasing a path this process never acquired (no recorded release) is a no-op —
// it can never remove another process's guard directory.
void test("Releasing a path this process never acquired (no recorded release) is a no-op...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await fs.mkdir(path + ".guard");
  await fs.writeFile(path, foreignSidecar("other-proc", 4242));

  await releaseLock(path);
  t.check(
    {
      guardSurvives: await fs.access(path + ".guard").then(() => true).catch(() => false),
      sidecarSurvives: await fs.access(path).then(() => true).catch(() => false),
    },
    { guardSurvives: true, sidecarSurvives: true },
  );
});

// ## inspectLock
//
// ### Returns null when not held
void test("Returns null when not held", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  t.check(await inspectLock(path), null);
});

// ### Returns the holder when held
void test("Returns the holder when held", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await acquireLock(path, { tag: "abc" });
  const info = await inspectLock(path);
  t.check(info, heldBy({ tag: "abc" }));
});

// ### A stale (crashed) holder reads as not held
//
// `inspectLock` uses `proper-lockfile`'s `.check()`, which treats a guard whose
// mtime is past the stale window as not held.
void test("inspectLock uses proper-lockfile's .check(), which treats a guard whose mtime...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  const guard = path + ".guard";
  await fs.mkdir(guard);
  const past = backdatedPast();
  await fs.utimes(guard, past, past);
  await fs.writeFile(path, foreignSidecar("ghost", 999999));

  t.check(await inspectLock(path), null);
});

// ## forceAcquireLock
//
// ### Steals a held lock
void test("Steals a held lock", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "test.lock");
  await fs.mkdir(path + ".guard");
  await fs.writeFile(path, foreignSidecar("victim", 4242));

  const stolen = await forceAcquireLock(path, { from: "thief" });
  t.check(stolen, heldBy({ from: "thief" }));
});

// ## scanLocks
//
// ### Returns empty map when directory missing
void test("Returns empty map when directory missing", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const map = await scanLocks(join(box.root, "nope"), { suffix: ".lock", profile: "default" });
  t.check(map, new Map());
});

// ### Returns live locks keyed by name (suffix stripped)
void test("Returns live locks keyed by name (suffix stripped)", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(join(dir, "alpha.lock"));
      await releaseLock(join(dir, "beta.lock"));
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const dir = join(box.root, "locks");
  await fs.mkdir(dir, { recursive: true });
  await acquireLock(join(dir, "alpha.lock"), { who: "a" });
  await acquireLock(join(dir, "beta.lock"), { who: "b" });

  const map = await scanLocks(dir, { suffix: ".lock", profile: "default" });
  t.check(
    map,
    new Map([
      ["alpha", heldBy({ who: "a" })],
      ["beta", heldBy({ who: "b" })],
    ]),
  );
});

// ### Reclaims dead (stale) locks during scan
//
// A live lock is reported; a crashed lock (stale guard mtime) is reclaimed — its
// guard dir and sidecar are removed — and excluded from the result. The reclaim
// happens while atomically holding the lock, so it can never delete a live
// holder's guard.
void test("A live lock is reported; a crashed lock (stale guard mtime) is reclaimed — it...", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(join(dir, "alive.lock"));
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const dir = join(box.root, "locks");
  await fs.mkdir(dir, { recursive: true });
  await acquireLock(join(dir, "alive.lock"), { who: "alive" });

  const deadPath = join(dir, "dead.lock");
  await fs.mkdir(deadPath + ".guard");
  const past = backdatedPast();
  await fs.utimes(deadPath + ".guard", past, past);
  await fs.writeFile(deadPath, foreignSidecar("ghost", 999999));

  const map = await scanLocks(dir, { suffix: ".lock", profile: "default" });
  const deadGuardGone = await fs.access(deadPath + ".guard").then(() => false).catch(() => true);
  const deadSidecarGone = await fs.access(deadPath).then(() => false).catch(() => true);
  t.check(map, new Map([["alive", heldBy({ who: "alive" })]]));
  t.check({ deadGuard: deadGuardGone ? "gone" : "exists", deadSidecar: deadSidecarGone ? "gone" : "exists" }, { deadGuard: "gone", deadSidecar: "gone" });
});

// ### Ignores files without the suffix
void test("Ignores files without the suffix", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(join(dir, "real.lock"));
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const dir = join(box.root, "locks");
  await fs.mkdir(dir, { recursive: true });
  await acquireLock(join(dir, "real.lock"), {});
  await fs.writeFile(join(dir, "real.json"), `{"pid":${process.pid}}`);

  const map = await scanLocks(dir, { suffix: ".lock", profile: "default" });
  t.check(map, new Map([["real", heldBy({})]]));
});

// ## withFileLock preserves a request-scoped target
//
// The blocking wrapper accepts the same profiled target as the lower-level lock
// operations, so short request-bound state updates retain their crash-recovery
// window.
void test("The blocking wrapper accepts the same profiled target as the lower-level lock...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "request-state.lock");
  const result = await withFileLock(
    { lockPath: requestScopedLock(path), metadata: { who: "wrapper" }, waitMs: 100 },
    async () => (await inspectLock(requestScopedLock(path)))?.metadata.who,
  );
  t.check(result, "wrapper");
  t.check(await inspectLock(requestScopedLock(path)), null);
});

// ## withFileLock gives up after `waitMs`
//
// Callers with a store-specific "stayed locked" error pass `timeoutError`; the
// others get the holder's `LockHeldError`. `fn` never runs on a timeout.
void test("withFileLock gives up after waitMs with timeoutError, or the holder's LockHeldError", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(path);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const path = join(box.root, "busy.lock");
  await acquireLock(path, { who: "holder" });
  let ran = false;
  const run = (timeoutError?: () => Error) =>
    withFileLock({ lockPath: path, metadata: { who: "waiter" }, waitMs: 150, ...(timeoutError ? { timeoutError } : {}) }, () => { ran = true; })
      .then(() => null, (e: unknown) => e);
  t.check(await run(() => new Error("store stayed locked")), { name: "Error", message: "store stayed locked" });
  t.check(await run(), heldError(process.pid, { who: "holder" }));
  t.check(ran, false);
});
