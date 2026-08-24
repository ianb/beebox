/**
 * The `CB_FAKE_GMAIL` gate (`docs/plans/agent-field-tests.md`, Track 1).
 *
 * A field run points a spawned `cb wakeup` at a fake mailbox by setting
 * `CB_FAKE_GMAIL=<state file>`. That env var is the single most dangerous
 * thing in the tier: an operator or a stray shell export could point a REAL
 * box's Gmail connector at synthetic mail, and the failure would be silent —
 * mail simply stops arriving while sync keeps reporting success.
 *
 * So the gate is fail-closed and has exactly three outcomes:
 *   env unset                  → null; the connector builds the real service,
 *                                byte-for-byte as before.
 *   env set + test-box marker  → the file-backed fake.
 *   env set, no marker         → THROW. Never fall back to the real service,
 *                                never warn and continue.
 *
 * The marker is `run-box.ts`'s `TEST_BOX_MARKER`, resolved against the same
 * operational box root the connector already holds. Real boxes never contain
 * it, and a field box gets it written and COMMITTED at creation, so the gate
 * survives the `reset` cleanup policy.
 */

import * as path from "node:path";
import { ConnectorFatalError } from "../connectors/index.js";
import { fileExists } from "../lib/file-exists.js";
import type { GoogleGmailService } from "../services/google-gmail.js";
import { createFakeGmailFromState, loadFakeGmailState } from "./fake-gmail-state.js";
import { TEST_BOX_MARKER } from "./run-box.js";

/** The env var naming the fake mailbox's state file. */
export const FAKE_GMAIL_ENV = "CB_FAKE_GMAIL";

/** `CB_FAKE_GMAIL` was set against a box that is not a field-test box.
 *  A {@link ConnectorFatalError}, so `cb wakeup`'s connector loop rethrows it
 *  instead of counting it as one more failed sync and continuing. */
class FakeGmailNotPermittedError extends ConnectorFatalError {
  constructor({ boxRoot, statePath }: { boxRoot: string; statePath: string }) {
    super(
      `${FAKE_GMAIL_ENV}=${statePath} is set, but ${boxRoot} is not a field-test box ` +
        `(no ${TEST_BOX_MARKER}). Refusing to serve fake mail to a real box — ` +
        `unset ${FAKE_GMAIL_ENV}, or run against a box created by \`cb field-test\`.`,
    );
    this.name = "FakeGmailNotPermittedError";
  }
}

/** True when this box carries the field-test marker. */
export async function isFieldTestBox(boxRoot: string): Promise<boolean> {
  return fileExists(path.join(boxRoot, TEST_BOX_MARKER));
}

/**
 * The gate. Returns the file-backed fake when `CB_FAKE_GMAIL` is set and the
 * box is permitted, `null` when the var is unset (the real path), and throws
 * otherwise.
 *
 * This is the ONLY read of `CB_FAKE_GMAIL` on the connector path — callers
 * pass a box root, not an env-derived path.
 */
export async function resolveFakeGmailService(
  boxRoot: string,
): Promise<GoogleGmailService | null> {
  // TODO(env-migration): harness var, still a direct read (see lib/env.ts).
  const statePath = process.env[FAKE_GMAIL_ENV];
  if (!statePath) return null;
  if (!await isFieldTestBox(boxRoot)) {
    throw new FakeGmailNotPermittedError({ boxRoot, statePath });
  }
  return createFakeGmailFromState(await loadFakeGmailState(statePath));
}
