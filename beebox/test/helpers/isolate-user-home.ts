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

import { mkdtempSync, rmSync } from "node:fs";
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
// of them. Best-effort — a HOME a child still holds open is deleted by the
// next run's sweep, not by a throw here.
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
