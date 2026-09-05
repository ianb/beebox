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
const testHome = mkdtempSync(join(tmpdir(), "bbx-test-home-"));
process.env["HOME"] = testHome;

// Removed when this process exits. Nothing else ever did: every test process
// left its HOME behind, and by 2026-09-05 the machine's temp dir held 56,000
// of them. Best-effort — a HOME a child still holds open is deleted by the
// next run's sweep, not by a throw here.
process.on("exit", () => {
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
