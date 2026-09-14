/**
 * Desktop notification for a sweep that actually did something.
 *
 * The uploader's whole point is to work invisibly: the launchd agent fires on
 * a folder change and on its interval, and its stdout goes to
 * `~/Library/Logs/scan-uploader.log`, which nobody reads. So there was no
 * moment where a person learned their scan had arrived — or that the server
 * had refused it. That is what this is for.
 *
 * Three rules shape it:
 *
 * **Silence on a quiet run.** Most sweeps upload nothing (the interval fires
 * regardless, and the folder-change trigger fires again on the disposition's
 * own rename). A notification per sweep would train the reader to ignore
 * notifications, so nothing is sent unless something happened.
 *
 * **Only newly-observed events.** A rejected file is left in place on purpose
 * and the server remembers its hash, so `RunSummary.rejected` stays at 1 on
 * every sweep from then on — notifying on it would nag forever, which is the
 * same failure as notifying on a quiet run. `rejectedOnUpload` is the subset
 * the server refused in *this* run's PUT, which is the first and only run that
 * learns it. Per-file transport errors and a missing target folder are
 * deliberately not notified: the transient ones resolve themselves on the next
 * sweep, and the sticky ones (an unmounted folder, a file over the size limit)
 * would nag every 15 minutes with nothing new to say. They stay on stdout and
 * in the exit code.
 *
 * **It should stay on screen until dismissed** — a scan that lands while you
 * are away should still be there when you get back. macOS calls that the
 * sender's *Alert* style, and it is a per-sender setting in System Settings →
 * Notifications that a sender cannot set for itself: no API, flag, or
 * AppleScript keyword changes it. (An AppleScript `display alert` persists,
 * but that is a dialog in front of your work, not a notification.) So all this
 * code can do is be a sender whose style is worth setting, which is why
 * `terminal-notifier` is preferred when it is installed: it posts under its
 * own identity, so setting that one entry to Alerts makes these notifications
 * persist without touching anything else on the machine. The `osascript`
 * fallback posts as "Script Editor", an identity shared with every other
 * AppleScript notification. The README's "Desktop notification" section has
 * the one-time toggle.
 *
 * macOS only, like the `trash` disposition; elsewhere it is a no-op. The
 * fallback matters because `terminal-notifier` is a Homebrew install and this
 * package is meant to run from a single copied file on a machine with no
 * checkout — the same two-step as `disposition.ts`. A notifier failure is
 * reported to stderr and dropped, never rethrown: it must never be able to
 * fail the sweep it is reporting on, the posture `beebox/deploy/notify-macos`
 * takes by exiting 0 when its notifier is absent.
 */

import { errorMessage } from "./error-guards.js";
import type { BoxSummary } from "./run-all.js";
import { escapeAppleScriptString, runCommand } from "./run-command.js";
import type { RunSummary } from "./run-target.js";

interface Banner {
  readonly title: string;
  readonly message: string;
  /** terminal-notifier replaces a previous notification in the same group. The
   * two kinds get separate groups so a routine "uploaded" cannot quietly take
   * the place of an unread refusal. */
  readonly group: string;
}

export interface NotifyOptions {
  /** Overrides `process.platform`, for the doctest. */
  readonly platform?: string;
}

/**
 * Sends the notifications a sweep's per-box totals warrant — none, for the
 * usual quiet sweep. Resolves either way; it cannot throw.
 */
export async function notifySweep(boxes: readonly BoxSummary[], options?: NotifyOptions): Promise<void> {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") return;
  for (const banner of bannersFor(boxes)) {
    await send(banner);
  }
}

function bannersFor(boxes: readonly BoxSummary[]): Banner[] {
  const banners: Banner[] = [];
  const uploaded = withCount(boxes, (s) => s.uploaded);
  if (uploaded.total > 0) {
    banners.push({
      title: "Scan uploaded",
      message: `${fileCount(uploaded.total)} uploaded to ${uploaded.boxes.join(", ")}`,
      group: "org.beebox.scan-uploader.uploaded",
    });
  }
  const refused = withCount(boxes, (s) => s.rejectedOnUpload);
  if (refused.total > 0) {
    banners.push({
      title: "Scan refused",
      message:
        `${fileCount(refused.total)} rejected by ${refused.boxes.join(", ")} — left in place. ` +
        "See ~/Library/Logs/scan-uploader.log for the reason.",
      group: "org.beebox.scan-uploader.refused",
    });
  }
  return banners;
}

function withCount(
  boxes: readonly BoxSummary[],
  count: (summary: RunSummary) => number,
): { total: number; boxes: string[] } {
  let total = 0;
  const named: string[] = [];
  for (const entry of boxes) {
    const n = count(entry.summary);
    if (n === 0) continue;
    total += n;
    named.push(entry.box);
  }
  return { total, boxes: named };
}

function fileCount(n: number): string {
  return `${String(n)} ${n === 1 ? "file" : "files"}`;
}

async function send(banner: Banner): Promise<void> {
  try {
    const cli = await runCommand("terminal-notifier", [
      "-title",
      banner.title,
      "-message",
      banner.message,
      "-group",
      banner.group,
    ]);
    if (cli.error === undefined && cli.code === 0) return;
    const fallback = await runCommand("osascript", ["-e", displayNotificationScript(banner)]);
    if (fallback.error !== undefined || fallback.code !== 0) {
      console.error(`notify: could not post "${banner.title}" (terminal-notifier and osascript both failed)`);
    }
  } catch (e) {
    // A notifier that cannot notify is not a reason for the sweep to fail, so
    // this is reported and dropped rather than rethrown.
    console.error(`notify: ${errorMessage(e)}`);
  }
}

function displayNotificationScript(banner: Banner): string {
  const message = escapeAppleScriptString(banner.message);
  const title = escapeAppleScriptString(banner.title);
  return `display notification "${message}" with title "${title}"`;
}
