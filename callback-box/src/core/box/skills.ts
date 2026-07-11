/**
 * Box skill provisioning — mirrors init-rules.ts (`generateRules`). Installs the
 * managed box skills into `<box>/.claude/skills/<name>/SKILL.md` so the box
 * agent (which auto-discovers project-level `.claude/skills/` via the SDK's
 * `settingSources`) can invoke them. Verified: a box-level skill is discovered
 * with no SDK-option change (see docs/implemented-plans/courseware-phase1.md, Track 1).
 *
 * Called from `cb init`.
 */

import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  BUILD_COURSE_SKILL,
  FIGURE_EXAMPLES,
  CALENDAR_SKILL,
  DRIVE_SKILL,
  EMAIL_SKILL,
  LOCATION_SKILL,
  SCHEDULES_SKILL,
  TRICKS_SKILL,
  VIEWS_SKILL,
} from "./skills-content.js";
import { getBoxShapeOrLegacyFallback } from "../../lib/box-shape.js";

interface BoxSkill {
  /** Skill directory name; matches the frontmatter `name`. */
  name: string;
  /** Full SKILL.md content (frontmatter + body). */
  content: string;
  /** Supplementary files written beside SKILL.md, loaded on demand by the agent. */
  files?: { name: string; content: string }[];
}

/**
 * The skills cb installs into every box. Every managed skill is a static
 * constant; per-box values the calendar skill needs (the box timezone, its
 * VTIMEZONE block) are reached at author time via the `BOX_TZ` placeholder and
 * `cb calendar vtimezone`, so nothing here is parameterized on the box.
 */
function buildBoxSkills(): BoxSkill[] {
  return [
    {
      name: "build-course",
      content: BUILD_COURSE_SKILL,
      files: [{ name: "figure-examples.md", content: FIGURE_EXAMPLES }],
    },
    { name: "calendar", content: CALENDAR_SKILL },
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
 * `docs/implemented-plans/boxes-as-packages-v2.md`). Idempotent overwrite — re-running
 * `cb init` refreshes them. Returns the skill names written. Only writes the
 * directories it manages, so a hand-authored box skill alongside is left
 * untouched.
 */
export async function generateSkills(boxRoot: string): Promise<string[]> {
  const { packageRoot } = await getBoxShapeOrLegacyFallback(boxRoot);
  const written: string[] = [];
  for (const skill of buildBoxSkills()) {
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
