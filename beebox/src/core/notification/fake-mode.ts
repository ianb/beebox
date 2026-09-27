/**
 * `BBX_NOTIFY_FAKE=1`: every channel sends through its fake service to a
 * synthetic audience, so a dev box exercises the whole delivery path with no
 * phone, browser, or Telegram chat, and the log records each delivery as
 * `sent (fake)`. See docs/implemented-plans/notifications.md ("Testability").
 *
 * `BBX_PUSH_FAKE=1`, the web-push-only switch this replaced, is read as an
 * alias for one release, with a warning.
 */

// TODO(env-migration): a harness flag, read lazily like BBX_STRICT_FETCH (lib/env.ts).
let warnedLegacy = false;

export function notifyFakeMode(): boolean {
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

/** The detail a delivery sent through a fake carries in the log. */
export const FAKE_DETAIL = "fake";
