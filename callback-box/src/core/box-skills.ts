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
import { BUILD_COURSE_SKILL } from "./box-skills-content.js";

interface BoxSkill {
  /** Skill directory name; matches the frontmatter `name`. */
  name: string;
  /** Full SKILL.md content (frontmatter + body). */
  content: string;
}

/** The skills cb installs into every box. */
const boxSkills: BoxSkill[] = [{ name: "build-course", content: BUILD_COURSE_SKILL }];

/**
 * Write each managed box skill to `<box>/.claude/skills/<name>/SKILL.md`
 * (idempotent overwrite — re-running `cb init` refreshes them). Returns the
 * skill names written. Only writes the directories it manages, so a
 * hand-authored box skill alongside is left untouched.
 */
export async function generateSkills(boxRoot: string): Promise<string[]> {
  const written: string[] = [];
  for (const skill of boxSkills) {
    const dir = join(boxRoot, ".claude", "skills", skill.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), skill.content);
    written.push(skill.name);
  }
  return written;
}
