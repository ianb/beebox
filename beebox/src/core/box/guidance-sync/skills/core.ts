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
 *
 * An active plugin's skill (`docs/plugins.md`) is mirrored the same way, named
 * after the plugin. The marker is also the overwrite guard: a `SKILL.md` that
 * exists without its own marker is the boxholder's, so the managed skill is
 * not written there and the name is reported as a conflict instead.
 */

import { join } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  CALENDAR_SKILL,
  DRIVE_SKILL,
  EMAIL_SKILL,
  LOCATION_SKILL,
  SCHEDULES_SKILL,
  TRICKS_SKILL,
  VIEWS_SKILL,
} from "./content.js";
import { BEEBOX_SYSTEM_FEEDBACK_SKILL } from "./content-beebox-system-feedback.js";
import { BROWSER_TASK_SKILL } from "./content-browser-task.js";
import { WHAT_CAN_YOU_DO_SKILL } from "./content-what-can-you-do.js";
import { getBoxShape } from "../../../../lib/box-shape.js";
import { errnoCode } from "../../../../shared/error-guards.js";
import { readDocId, withDocId } from "../../../docs-gen/shared.js";
import { activePlugins } from "../../../plugins/active.js";
import type { PluginDefinition } from "../../../../cards/plugin-definition.js";

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

/** A managed skill whose directory already holds a `SKILL.md` the engine did not write. */
export interface SkillConflict {
  name: string;
  /** Box-relative path of the file left in place. */
  path: string;
}

/** The skill `plugin.skill` becomes: Claude Code frontmatter, then the body the plugin shipped. */
function pluginSkill(plugin: PluginDefinition, skill: string): BoxSkill {
  return {
    name: plugin.name,
    content: `---\nname: ${plugin.name}\ndescription: ${plugin.description}\n---\n\n${skill}`,
  };
}

/**
 * The skills bbx installs into every box, then the active plugins' skills.
 * Per-box values the calendar skill needs (the box timezone, its VTIMEZONE
 * block) are reached at author time via the `BOX_TZ` placeholder and
 * `bbx calendar vtimezone`. A plugin's skill is here only while the plugin is
 * active (`docs/plugins.md`), so deactivating it retires the skill.
 */
function buildBoxSkills(plugins: readonly PluginDefinition[]): BoxSkill[] {
  const skills: BoxSkill[] = [
    { name: "beebox-system-feedback", content: BEEBOX_SYSTEM_FEEDBACK_SKILL },
    { name: "browser-task", content: BROWSER_TASK_SKILL },
    { name: "calendar", content: CALENDAR_SKILL },
    { name: "drive", content: DRIVE_SKILL },
    { name: "email", content: EMAIL_SKILL },
    { name: "location", content: LOCATION_SKILL },
    { name: "schedules", content: SCHEDULES_SKILL },
    { name: "tricks", content: TRICKS_SKILL },
    { name: "views", content: VIEWS_SKILL },
    { name: "what-can-you-do", content: WHAT_CAN_YOU_DO_SKILL },
  ];
  for (const plugin of plugins) {
    if (plugin.skill !== undefined) skills.push(pluginSkill(plugin, plugin.skill));
  }
  return skills;
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

/** `skill`'s conflict when its `SKILL.md` exists in the box without the marker naming itself; null when the engine may write it. */
async function skillConflict(shapeBoxRoot: string, skill: BoxSkill): Promise<SkillConflict | null> {
  const path = `${SKILLS_DIR}/${skill.name}/SKILL.md`;
  let content: string;
  try {
    content = await readFile(join(shapeBoxRoot, path), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  return readDocId(content) === path ? null : { name: skill.name, path };
}

/** The conflicts `generateSkills` would report now, without writing anything (for the health check). */
export async function skillConflicts(boxRoot: string): Promise<SkillConflict[]> {
  const { boxRoot: shapeBoxRoot } = await getBoxShape(boxRoot);
  const conflicts: SkillConflict[] = [];
  for (const skill of buildBoxSkills(await activePlugins(boxRoot))) {
    const conflict = await skillConflict(shapeBoxRoot, skill);
    if (conflict !== null) conflicts.push(conflict);
  }
  return conflicts;
}

/**
 * Write each managed box skill to `<boxRoot>/.claude/skills/<name>/SKILL.md`
 * plus its supplementary files, each marked. Idempotent overwrite: any
 * `generateDocs` run past its cache refreshes them. A skill whose `SKILL.md`
 * exists unmarked is skipped and returned in `conflicts`. `written` is the
 * prune manifest: in a skill directory not in it, every file carrying the
 * marker naming its own path goes, and the directory goes when nothing is
 * left; a managed skill's marked file that the skill no longer ships goes too.
 * A hand-authored box skill alongside carries no marker and is left untouched.
 */
export async function generateSkills(boxRoot: string): Promise<{ written: string[]; conflicts: SkillConflict[] }> {
  const { boxRoot: shapeBoxRoot } = await getBoxShape(boxRoot);
  const skillsDir = join(shapeBoxRoot, SKILLS_DIR);
  const written: string[] = [];
  const conflicts: SkillConflict[] = [];
  for (const skill of buildBoxSkills(await activePlugins(boxRoot))) {
    const conflict = await skillConflict(shapeBoxRoot, skill);
    if (conflict !== null) {
      conflicts.push(conflict);
      continue;
    }
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
  const manifest = new Set([...written, ...conflicts.map((c) => c.name)]);
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || manifest.has(entry.name)) continue;
    const relDir = `${SKILLS_DIR}/${entry.name}`;
    if (await markedPath(join(shapeBoxRoot, `${relDir}/SKILL.md`)) !== `${relDir}/SKILL.md`) continue;
    const dir = join(skillsDir, entry.name);
    await pruneMarkedFiles(dir, { relDir, keep: new Set() });
    if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true });
  }
  return { written, conflicts };
}

/** Remove files in a managed skill directory that carry their own marker but are not in `keep`. */
async function pruneMarkedFiles(dir: string, params: { relDir: string; keep: ReadonlySet<string> }): Promise<void> {
  const { relDir, keep } = params;
  for (const name of await readdir(dir)) {
    if (keep.has(name)) continue;
    if (await markedPath(join(dir, name)) === `${relDir}/${name}`) await rm(join(dir, name));
  }
}
