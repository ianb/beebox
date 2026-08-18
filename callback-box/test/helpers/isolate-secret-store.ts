/**
 * Keep the test suite away from the developer's real secret store.
 *
 * Loaded by `.taprc`'s `node-arg` in EVERY test process, before any test code
 * runs, so `CB_SECRETS_FILE` already points somewhere disposable by the time
 * anything resolves or writes a secret. Doing it here rather than in the box
 * helpers is deliberate: plenty of tests build a box root with a bare
 * `mkdtemp` and never touch a helper, and the failure mode is silent — a
 * passing test that quietly wrote a grant into `~/.config/cb/secrets.json`,
 * a real credential store. Isolation has to be the process default, not a
 * convention each new test remembers.
 *
 * A test that sets `CB_SECRETS_FILE` itself (most of the secrets doctests, so
 * they can point two reads at different stores) keeps its own path.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env["CB_SECRETS_FILE"] === undefined) {
  process.env["CB_SECRETS_FILE"] = join(mkdtempSync(join(tmpdir(), "cb-test-secrets-")), "secrets.json");
}
