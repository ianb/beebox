/**
 * Box skill provisioning — mirrors init-rules.ts (`generateRules`). Installs the
 * managed box skills into `<box>/.claude/skills/<name>/SKILL.md` so the box
 * agent (which auto-discovers project-level `.claude/skills/` via the SDK's
 * `settingSources`) can invoke them. Verified: a box-level skill is discovered
 * with no SDK-option change (see docs/plans/courseware-phase1.md, Track 1).
 *
 * Called from `cb init`.
 */

import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  BUILD_COURSE_SKILL,
  FIGURE_EXAMPLES,
  calendarSkill,
  DRIVE_SKILL,
  EMAIL_SKILL,
  LOCATION_SKILL,
  SCHEDULES_SKILL,
  TRICKS_SKILL,
  VIEWS_SKILL,
} from "./box-skills-content.js";
import { vtimezoneBlock } from "../connectors/google-calendar-ics.js";
import { loadBoxTimezone } from "../webapp/box-config.js";
import { getBoxShapeOrLegacyFallback } from "../cli/lib/box-shape.js";

interface BoxSkill {
  /** Skill directory name; matches the frontmatter `name`. */
  name: string;
  /** Full SKILL.md content (frontmatter + body). */
  content: string;
  /** Supplementary files written beside SKILL.md, loaded on demand by the agent. */
  files?: { name: string; content: string }[];
}

/**
 * The skills cb installs into every box. The calendar skill is generated
 * per-box: its .ics example carries the box's configured timezone (falling
 * back to the server's zone when none is configured) with a correct VTIMEZONE
 * block, so the agent copies real values instead of adapting a sample zone.
 */
async function buildBoxSkills(boxRoot: string): Promise<BoxSkill[]> {
  const timezone =
    (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const vtimezone = vtimezoneBlock(timezone).replaceAll("\r\n", "\n");
  return [
    {
      name: "build-course",
      content: BUILD_COURSE_SKILL,
      files: [{ name: "figure-examples.md", content: FIGURE_EXAMPLES }],
    },
    { name: "calendar", content: calendarSkill({ timezone, vtimezone }) },
    { name: "drive", content: DRIVE_SKILL },
    { name: "email", content: EMAIL_SKILL },
    { name: "location", content: LOCATION_SKILL },
    { name: "schedules", content: SCHEDULES_SKILL },
    { name: "tricks", content: TRICKS_SKILL },
    { name: "views", content: VIEWS_SKILL },
  ];
}

/**
 * Write each managed box skill to `<packageRoot>/.claude/skills/<name>/SKILL.md`
 * (`.claude/` lives at the box's package root, which equals `boxRoot` for a
 * legacy box — see "Where Claude Code runs" in
 * `docs/plans/boxes-as-packages-v2.md`). Idempotent overwrite — re-running
 * `cb init` refreshes them. Returns the skill names written. Only writes the
 * directories it manages, so a hand-authored box skill alongside is left
 * untouched.
 */
export async function generateSkills(boxRoot: string): Promise<string[]> {
  const { packageRoot } = await getBoxShapeOrLegacyFallback(boxRoot);
  const written: string[] = [];
  for (const skill of await buildBoxSkills(boxRoot)) {
    const dir = join(packageRoot, ".claude", "skills", skill.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), skill.content);
    for (const file of skill.files ?? []) {
      await writeFile(join(dir, file.name), file.content);
    }
    written.push(skill.name);
  }
  return written;
}
