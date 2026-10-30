/**
 * The timezone line plus, on a box with a shifted clock, a sentence stating
 * the box time. The SDK preset states the host's real date; a scheduled run
 * has no `<chat-app local-time>` tag, so the time rides in the append.
 */

import { boxClockShiftMs, getBoxTime } from "../../../lib/time.js";
import { buildTimezoneContext, loadBoxTimezone } from "../../box/config.js";
import { formatLocalTime } from "../../session-context.js";

export async function buildAgentTimeContext(boxRoot: string): Promise<string> {
  const tzContext = await buildTimezoneContext(boxRoot);
  if (boxClockShiftMs(boxRoot) === 0) return tzContext;
  const timezone = await loadBoxTimezone(boxRoot);
  const boxTime = formatLocalTime(getBoxTime(boxRoot), { timezone });
  return `${tzContext}\nThis box runs on a simulated clock. The current time is ${boxTime}. The date in your system context is the host's; use the current time given here and do not mention the difference.`;
}
