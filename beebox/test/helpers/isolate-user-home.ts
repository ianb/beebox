/**
 * Keep tests and every subprocess they spawn away from the developer's home.
 *
 * The CLI performs one-shot migration of several home-relative state and config
 * directories before command dispatch. File-specific test overrides cannot
 * isolate that startup boundary, and a child CLI does not inherit TAP's Node
 * preload arguments. A temporary HOME does cross the process boundary, so both
 * the test and its children resolve all home-relative paths inside one
 * throwaway directory.
 *
 * Loaded by `.taprc` before application modules. Tests that need a specific
 * home can replace HOME after preloads have run.
 */

import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const realHome = process.env["HOME"] ?? homedir();

// The manual tier (`pnpm test:manual`) exists to exercise REAL services, and
// the one real thing a throwaway HOME hides is the developer's Claude Code
// login: `claude auth status` reports logged-out under any other HOME, even
// with `~/.claude` linked in, so the real-SDK doctest failed its auth
// preflight every week from 2026-09-08. That tier opts out of the HOME swap
// with this variable and keeps its real home; every other isolation below
// (uv cache, url checks) and beside this file (secret store, auth file,
// origin id, Codex home) is its own variable and stays in force.
const keepRealHome = process.env["BBX_TEST_REAL_HOME"] === "1";
const testHome = keepRealHome ? null : mkdtempSync(join(tmpdir(), "bbx-test-home-"));
if (testHome !== null) process.env["HOME"] = testHome;

// Removed when this process exits. Nothing else ever did: every test process
// left its HOME behind, and by 2026-09-05 the machine's temp dir held 56,000
// of them. Best-effort — a HOME a child still holds open is left for
// `sweepStaleTempDirs()` below, not thrown about here.
process.on("exit", () => {
  if (testHome === null) return;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch (_e) {
    // Leaving one directory behind is the pre-existing behavior, not a failure.
  }
});

// One thing is NOT isolated: uv's package cache. It defaults to
// `$HOME/.cache/uv`, so under the throwaway HOME every `uvx` a test runs
// started from an empty cache — the Docling integration probe rebuilt a
// multi-hundred-MB torch environment on every suite run (and macOS Gatekeeper
// popped "Verifying libtorch…" for each freshly downloaded dylib), then timed
// out and skipped anyway. The cache is content-addressed and safe to share;
// sharing it is what makes a warmed environment warm inside the suite.
process.env["UV_CACHE_DIR"] ??= join(realHome, ".cache", "uv");

// No background URL checks from test boxes. Every commit in a fixture box
// fires the post-commit hook's detached `bbx validate --urls`; the fixture is
// then deleted under it, the check spins at full CPU forever, and by
// 2026-09-05 dozens of them were pinning the machine. Tests have no business
// on the network from a hook anyway.
process.env["BBX_NO_URLCHECK"] = "1";


/**
 * Sweep temp directories earlier runs left behind.
 *
 * Per-process exit cleanup (above) and per-test `t.teardown` both fail the same
 * way: the leak is process-KILL shaped. A suite killed by the developer, a
 * worker OOM-killed under load, a crashed child — none of them run cleanup, and
 * macOS clears `$TMPDIR` only on reboot. Nothing ever swept, and the count
 * compounds: ~10k orphans filled the disk on 2026-09-04, and on 2026-09-12
 * there were **519,712** `bbx-*` entries, 514,972 of them older than two hours.
 * Half a million directories is slow to even enumerate, which is its own tax on
 * every later sweep (issues/bugs/2026-09-04-doctest-tmp-dirs-leak-until-disk-full.md).
 *
 * Three things keep this from being a cure worse than the disease:
 *
 * - **An age floor.** Only entries older than `STALE_MS` are touched, so a
 *   directory belonging to THIS run — or to a suite running in parallel in
 *   another worktree — is never pulled out from under it.
 * - **A stamp gate.** This module is preloaded into every test process, and a
 *   suite is hundreds of them. A shared stamp file means the scan happens at
 *   most once per `SWEEP_INTERVAL_MS`, whoever gets there first.
 * - **A work cap.** A large backlog is cleared over several runs rather than
 *   stalling one startup for minutes.
 *
 * Entirely best-effort: every failure is swallowed. A test run must never fail
 * because housekeeping could not delete a directory.
 */
const STALE_MS = 2 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_MAX_REMOVALS = 2000;
const SWEEP_PREFIXES = ["bbx-doctest-", "bbx-test-home-"];

function claimSweep(stamp: string): boolean {
  try {
    // Fresh stamp: someone swept recently, nothing to do.
    if (Date.now() - statSync(stamp).mtimeMs < SWEEP_INTERVAL_MS) return false;
    // Claim it BEFORE scanning, so parallel starters don't all scan at once.
    utimesSync(stamp, new Date(), new Date());
    return true;
  } catch (_e) {
    try {
      writeFileSync(stamp, "");
      return true;
    } catch (_writeErr) {
      return false; // Can't claim it — skip rather than risk a concurrent sweep.
    }
  }
}

function sweepStaleTempDirs(): void {
  const root = tmpdir();
  if (!claimSweep(join(root, "bbx-tmp-sweep.stamp"))) return;
  const cutoff = Date.now() - STALE_MS;
  let removed = 0;
  try {
    for (const name of readdirSync(root)) {
      if (removed >= SWEEP_MAX_REMOVALS) break;
      if (!SWEEP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      const full = join(root, name);
      try {
        if (statSync(full).mtimeMs >= cutoff) continue;
        rmSync(full, { recursive: true, force: true });
        removed += 1;
      } catch (_entryErr) {
        // A vanished or unreadable entry is not this sweep's problem.
      }
    }
  } catch (_e) {
    // An unreadable temp root leaves the backlog for next time.
  }
}

if (!keepRealHome) sweepStaleTempDirs();
