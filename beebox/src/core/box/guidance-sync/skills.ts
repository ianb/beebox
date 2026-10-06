/**
 * Box skill provisioning — mirrors init-rules.ts (`generateRules`). Installs the
 * managed box skills into `<box>/.claude/skills/<name>/SKILL.md` so the box
 * agent (which auto-discovers project-level `.claude/skills/` via the SDK's
 * `settingSources`) can invoke them. Verified: a box-level skill is discovered
 * with no SDK-option change (see docs/implemented-plans/courseware-phase1.md, Track 1).
 *
 * Called from `syncBoxGuidance` when the `generateDocs` template sync runs it
 * (`initBox` runs the walk without generators), so managed skills refresh wherever card rules do — `bbx
 * init`, `bbx wakeup`, a chat session start, `bbx migrate --apply`, and `bbx
 * docs refresh`. Every file written carries the DOCID marker (after the
 * frontmatter in `SKILL.md`), which is what lets the prune tell a retired
 * managed skill from a boxholder's own.
 */

import { join } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { BEEBOX_SYSTEM_FEEDBACK_SKILL } from "./skills-content-beebox-system-feedback.js";
import { WHAT_CAN_YOU_DO_SKILL } from "./skills-content-what-can-you-do.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { readDocId, withDocId } from "../../docs-gen/shared.js";

/** Box-relative skills directory. */
const SKILLS_DIR = ".claude/skills";

interface BoxSkill {
  /** Skill directory name; matches the frontmatter `name`. */
  name: string;
  /** Full SKILL.md content (frontmatter + body). */
  content: string;
  /** Supplementary files written beside SKILL.md, loaded on demand by the agent. */
  files?: { name: string; content: string }[];
}

/**
 * The skills bbx installs into every box. Every managed skill is a static
 * constant; per-box values the calendar skill needs (the box timezone, its
 * VTIMEZONE block) are reached at author time via the `BOX_TZ` placeholder and
 * `bbx calendar vtimezone`, so nothing here is parameterized on the box.
 */
function buildBoxSkills(): BoxSkill[] {
  return [
    { name: "beebox-system-feedback", content: BEEBOX_SYSTEM_FEEDBACK_SKILL },
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
    { name: "what-can-you-do", content: WHAT_CAN_YOU_DO_SKILL },
  ];
}

/** The DOCID marker path a file carries, or null when it is missing, a directory, or unmarked. */
async function markedPath(absPath: string): Promise<string | null> {
  try {
    return readDocId(await readFile(absPath, "utf8"));
  } catch (e) {
    const code = errnoCode(e);
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw e;
  }
}

/**
 * Write each managed box skill to `<boxRoot>/.claude/skills/<name>/SKILL.md`
 * plus its supplementary files, each marked. Idempotent overwrite: any
 * `generateDocs` run past its cache refreshes them. Returns the skill names
 * written, which are also the prune manifest: a skill directory not in it goes
 * only when its `SKILL.md` carries the marker naming its own path, and a
 * managed skill's marked file that the skill no longer ships goes too. A
 * hand-authored box skill alongside carries no marker and is left untouched.
 */
export async function generateSkills(boxRoot: string): Promise<string[]> {
  const { boxRoot: shapeBoxRoot } = await getBoxShape(boxRoot);
  const skillsDir = join(shapeBoxRoot, SKILLS_DIR);
  const written: string[] = [];
  for (const skill of buildBoxSkills()) {
    const dir = join(skillsDir, skill.name);
    await mkdir(dir, { recursive: true });
    const files = [{ name: "SKILL.md", content: skill.content }, ...(skill.files ?? [])];
    for (const file of files) {
      const relativePath = `${SKILLS_DIR}/${skill.name}/${file.name}`;
      await writeFile(join(dir, file.name), withDocId({ relativePath, content: file.content }));
    }
    await pruneMarkedFiles(dir, {
      relDir: `${SKILLS_DIR}/${skill.name}`,
      keep: new Set(files.map((f) => f.name)),
    });
    written.push(skill.name);
  }
  const manifest = new Set(written);
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || manifest.has(entry.name)) continue;
    const skillFile = `${SKILLS_DIR}/${entry.name}/SKILL.md`;
    if (await markedPath(join(shapeBoxRoot, skillFile)) === skillFile) {
      await rm(join(skillsDir, entry.name), { recursive: true });
    }
  }
  return written;
}

/** Remove files in a managed skill directory that carry their own marker but are not in `keep`. */
async function pruneMarkedFiles(dir: string, params: { relDir: string; keep: ReadonlySet<string> }): Promise<void> {
  const { relDir, keep } = params;
  for (const name of await readdir(dir)) {
    if (keep.has(name)) continue;
    if (await markedPath(join(dir, name)) === `${relDir}/${name}`) await rm(join(dir, name));
  }
}
