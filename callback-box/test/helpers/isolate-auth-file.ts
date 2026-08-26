/**
 * Keep the test suite away from the developer's real credential store.
 *
 * `~/.cb-auth.json` (`CB_AUTH_FILE`) is machine-level — one file behind every
 * local box — and `~/.cb-session-secret` (`CB_SESSION_SECRET`) is minted and
 * persisted on first read. Any test that resolves an owner, a local user, or a
 * session would otherwise read the developer's users or write a secret into
 * their home directory, and the failure mode is silent: a passing test that
 * saw a real owner email. Same shape as `isolate-secret-store.ts`, and for the
 * same reason it lives in `.taprc` rather than a box helper: isolation has to
 * be the process default, not a convention each new test remembers.
 *
 * A test that sets either variable itself (the auth doctests, which point at
 * fixture stores) keeps its own value.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env["CB_AUTH_FILE"] === undefined) {
  process.env["CB_AUTH_FILE"] = join(mkdtempSync(join(tmpdir(), "cb-test-auth-")), "auth.json");
}
if (process.env["CB_SESSION_SECRET"] === undefined) {
  process.env["CB_SESSION_SECRET"] = "test-session-secret";
}
