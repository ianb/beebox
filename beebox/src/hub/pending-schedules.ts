/**
 * Hub-side "does this box have pending chat schedules?" check, split out of
 * `supervisor.ts` to keep that file under the 300-line cap (the same reason
 * `child-env.ts`/`child-spawn.ts` were extracted).
 *
 * The invariant this supports: a configured box whose `chat-schedules.json`
 * holds ANY unfired entry must be running, because those timers live in the
 * box's `bbx serve` process and a missed alarm is unacceptable. The supervisor
 * consults this both to exempt a schedule-holding box from lazy idle-stop and
 * to pre-start such boxes at hub boot.
 *
 * It reuses `loadChatSchedules` (the exact loader `bbx serve` re-arms from) so
 * the hub's notion of "pending" can never drift from what serve would fire.
 */

import { loadChatSchedules } from "../core/chat/schedules.js";
import { describeError } from "./child-process-utils.js";
import { requireBoxRoot } from "../lib/box-shape.js";

/**
 * Whether a hub box entry holds ANY pending (unfired) chat schedule on disk.
 * Resolves the `hub.json` entry path to its content root the same way launches
 * do, then loads and validates the schedule file with the exact loader
 * `bbx serve` re-arms from. Counts overdue-unfired entries too — an overdue
 * schedule still needs the box up to fire it, so `getActive()`'s future-only
 * filter is deliberately NOT used here.
 *
 * A path that won't resolve (not a box) is warned and reported as "none": the
 * box would fail to launch on demand anyway, so there's nothing to keep up.
 */
export async function boxHasPendingSchedules({
  slug,
  entryPath,
}: {
  slug: string;
  entryPath: string;
}): Promise<boolean> {
  try {
    const boxRoot = await requireBoxRoot(entryPath);
    return loadChatSchedules({ boxRoot }).length > 0;
  } catch (e) {
    console.warn(`[hub] chat-schedule check failed for "${slug}", treating as none: ${describeError(e)}`);
    return false;
  }
}
