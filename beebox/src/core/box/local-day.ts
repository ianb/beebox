/** The box-local calendar day, as `YYYY-MM-DD`. */

import { getBoxTime } from "../../lib/time.js";
import { localDay } from "../../shared/local-day.js";
import { boxTimeZoneOrHost } from "./config.js";

/**
 * The day `now` falls on in the box's timezone. Without `now`, the box clock
 * (`getBoxTime`) is read after the timezone loads.
 */
export async function boxLocalDay(boxRoot: string, now?: Date): Promise<string> {
  const timeZone = await boxTimeZoneOrHost(boxRoot);
  return localDay(now ?? getBoxTime(boxRoot), timeZone);
}
