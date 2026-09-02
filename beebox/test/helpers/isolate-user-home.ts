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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "bbx-test-home-"));
