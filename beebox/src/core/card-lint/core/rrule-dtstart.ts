/**
 * A scheduled script's `rrule` should say when it starts. Without a DTSTART the
 * scheduler counts from midnight UTC of the last run's day
 * (`parseScheduleRrule`), which is rarely the time a person meant, and COUNT or
 * an INTERVAL phase have nothing fixed to count from. The schedule still runs;
 * this is a warning so the agent writing the card adds the start.
 *
 * Schedules run in UTC, so the DTSTART is written in UTC. When the box has a
 * timezone, the message names it: the boxholder's "9am" is converted from it.
 */

import type { LintIssue } from "../../../cards/lint-format.js";
import { loadBoxTimezone } from "../../box/config.js";

export async function rruleDtstartWarnings({ fields, boxRoot }: { fields: Record<string, unknown>; boxRoot: string }): Promise<LintIssue[]> {
  const rrule = fields["rrule"];
  if (typeof rrule !== "string" || /\bDTSTART\b/iu.test(rrule)) return [];
  const timezone = await loadBoxTimezone(boxRoot);
  const convert = timezone === null
    ? "in UTC"
    : `in UTC, converted from this box's timezone (${timezone})`;
  return [{
    type: "validation",
    severity: "warning",
    message: `rrule has no DTSTART, so it runs at midnight UTC on matching days. Add the start ${convert}: \`${rrule.trim()};DTSTART=<yyyymmdd>T<hhmmss>Z\``,
  }];
}
