/**
 * "How long ago" for a timestamp on a named clock. The formatting itself
 * (`formatAgo`, `formatDuration`) lives in `@shared/relative-time`, shared
 * with the CLI and health checks.
 */

import { formatAgo } from "@shared/relative-time";
import { boxNow } from "./box-clock";

/**
 * {@link formatAgo} for a timestamp. `box` reads a stamp the box wrote on its
 * own clock (commit dates); `real` reads the browser's clock, for stamps from
 * the host or elapsed time since a start. An unparseable string comes back as
 * written rather than "NaNd ago".
 */
export function agoOnClock(ts: string | number, clock: "box" | "real"): string {
  const at = typeof ts === "number" ? ts : Date.parse(ts);
  if (Number.isNaN(at)) return String(ts);
  return formatAgo(at, clock === "box" ? boxNow() : Date.now());
}
