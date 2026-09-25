/**
 * Whether the box's hourly Drive sync is switched on, and what to say when it
 * isn't.
 *
 * `check-drive` ships seeded and disabled (`core/box/defaults.ts`), which is
 * the right default and a bad surprise: a mount that was just created and
 * verified will not stay in step with Drive until someone enables it. The
 * moment that matters is the mount itself, so the mount result carries the
 * sentence and the settings page shows the same state
 * (`docs/plans/agent-capability-delegation.md`).
 *
 * Enabling is deliberately not something this hint tells a caller to do on its
 * own: turning a seeded schedule on is the boxholder's, unless they asked in
 * chat (the 2026-07-20 decision).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";
import { isRecord } from "../lib/is-record.js";
import { errnoCode } from "../lib/error-guards.js";
import { getBoxDir } from "../lib/paths.js";

/** The seeded hourly Drive sync, by the name its card and `--script` use. */
export const CHECK_DRIVE_SCHEDULE = "check-drive";

/** What the box has: the schedule on, off, or never seeded. */
export type CheckDriveState = "enabled" | "disabled" | "absent";

/**
 * Read the schedule card's own `enabled` field.
 *
 * A light frontmatter read rather than the full scheduled-script parse: this
 * asks one boolean question, and a card that fails the full parse is still a
 * card whose `enabled` a person can see — reporting `absent` for it would say
 * something false.
 */
export async function checkDriveScheduleState(boxRoot: string): Promise<CheckDriveState> {
  const cardPath = path.join(
    getBoxDir(boxRoot, "schedules"),
    `${CHECK_DRIVE_SCHEDULE}.scheduled-script.card`,
  );
  let content: string;
  try {
    content = await fs.readFile(cardPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return "absent";
    throw e;
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return "disabled";
  const fields: unknown = parseYaml(split.frontmatterText);
  // `enabled` is optional and defaults to true (`schemas/scheduled-script.tsx`),
  // so only an explicit `false` is off.
  if (isRecord(fields) && fields["enabled"] === false) return "disabled";
  return "enabled";
}

/**
 * One sentence for a caller who just mounted something, or null when there is
 * nothing to say — the schedule is on, or this box never got the seed and the
 * mount is not the place to explain that.
 */
export async function checkDriveScheduleHint(boxRoot: string): Promise<string | null> {
  if ((await checkDriveScheduleState(boxRoot)) !== "disabled") return null;
  return (
    "Hourly Drive sync (check-drive) is off, so this mount only updates when " +
    "something asks it to. Ask the boxholder whether to turn it on — they enable " +
    "it under Schedules in box settings. Either way, `bbx force-wakeup --connector " +
    "google-drive` syncs it now."
  );
}
