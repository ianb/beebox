/**
 * Fake notifications: every channel sends through its fake service to a
 * synthetic audience, so a dev box exercises the whole delivery path with no
 * phone or browser, and the log records each delivery as
 * `sent (fake)`. See docs/implemented-plans/notifications.md ("Testability").
 *
 * On for every box in the process with `BBX_NOTIFY_FAKE=1`, or for one box
 * with `fakeNotifications: true` in its `_config/box.json` (journey walk
 * boxes; docs/implemented-plans/journey-simulated-notifications.md).
 *
 * `BBX_PUSH_FAKE=1`, the web-push-only switch this replaced, is read as an
 * alias for one release, with a warning.
 */

import { loadBoxConfig } from "../box/config.js";

// TODO(env-migration): a harness flag, read lazily like BBX_STRICT_FETCH (lib/env.ts).
let warnedLegacy = false;
const warnedValue = new Set<string>();

function processFakeMode(): boolean {
  if (process.env.BBX_NOTIFY_FAKE === "1") return true;
  if (process.env.BBX_PUSH_FAKE === "1") {
    if (!warnedLegacy) {
      warnedLegacy = true;
      console.warn("[notify] BBX_PUSH_FAKE is renamed BBX_NOTIFY_FAKE and now fakes every channel; the old name stops working next release.");
    }
    return true;
  }
  return false;
}

/**
 * Whether this box's notifications go only to fakes. A `fakeNotifications`
 * value other than `true` reads as on: a box that tried to say "fake" must
 * not send for real.
 */
export async function notifyFakeMode(boxRoot: string): Promise<boolean> {
  if (processFakeMode()) return true;
  const value: unknown = (await loadBoxConfig(boxRoot)).fakeNotifications;
  if (value === undefined) return false;
  if (value !== true && !warnedValue.has(boxRoot)) {
    warnedValue.add(boxRoot);
    console.warn(`[notify] fakeNotifications in ${boxRoot}/_config/box.json is ${JSON.stringify(value)}, not true; treating notifications as fake.`);
  }
  return true;
}

/** The detail a delivery sent through a fake carries in the log. */
export const FAKE_DETAIL = "fake";
