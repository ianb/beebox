/**
 * Keep the test suite away from the machine's real origin id.
 *
 * Loaded by `.taprc`'s `node-arg` in EVERY test process, for the same reason
 * as `isolate-secret-store.ts`: every husk a test creates records the machine
 * that holds its transcript (`core/chat/session/origin.ts`), and any test that
 * starts a chat reaches that code without going near a helper. Without this,
 * a suite run mints (or reads) `~/.local/share/cb/origin-id` — real per-user
 * state, and the file whose loss re-origins every chat on the machine.
 *
 * A test that sets `CB_ORIGIN_ID_FILE` itself keeps its own path.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env["CB_ORIGIN_ID_FILE"] === undefined) {
  process.env["CB_ORIGIN_ID_FILE"] = join(mkdtempSync(join(tmpdir(), "cb-test-origin-")), "origin-id");
}
