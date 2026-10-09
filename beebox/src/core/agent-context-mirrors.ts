/** Materialize the editable Claude-authored context for Codex. */

import { dirname, join, relative } from "node:path";
import { lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { errnoCode } from "../shared/error-guards.js";
import { getBoxShape } from "../lib/box-shape.js";
import { AGENTS_MD, CLAUDE_MD } from "./agent-instruction-files.js";
import { withDocId, withoutDocId } from "./docs-gen/shared.js";

/**
 * The line an older engine wrote into a generated `AGENTS.md` file, before the
 * mirror became a symlink. Kept only to recognize and replace those files; the
 * mirror itself is a symlink and carries no marker.
 */
const GENERATED_AGENTS_MARKER = "GENERATED from Claude guidance";

/** Whether `content` is a legacy generated `AGENTS.md` (an old mirror, not authored guidance). */
export function isLegacyGeneratedAgentsFile(content: string): boolean {
  return content.includes(GENERATED_AGENTS_MARKER);
}

async function pathKind(path: string): Promise<"missing" | "symlink" | "file" | "directory"> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return "symlink";
    if (info.isDirectory()) return "directory";
    return "file";
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return "missing";
    throw error;
  }
}

async function ensureRelativeSymlink(linkPath: string, targetPath: string): Promise<boolean> {
  const target = relative(dirname(linkPath), targetPath);
  const kind = await pathKind(linkPath);
  if (kind === "symlink") {
    if (await readlink(linkPath) === target) return false;
    await rm(linkPath);
  } else if (kind !== "missing") {
    return false;
  }
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(target, linkPath);
  return true;
}

/**
 * Directory names the instruction-file walk never enters. `_template-updates`
 * (the basename of `_config/_template-updates`, which install-template-file.ts
 * owns) holds parked copies of templates awaiting review, not active guidance.
 * Mirroring a parked CLAUDE.md offers a Codex session a guide the box has not
 * adopted, and the mirror dangles once the parked copy is accepted or
 * discarded.
 */
export const INSTRUCTION_WALK_SKIP_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", ".agents", "_template-updates"]);

interface ClaudeDocScan {
  claudeDocs: string[];
  /** `AGENTS.md` symlinks whose `CLAUDE.md` target is gone. */
  danglingMirrors: string[];
}

async function findClaudeDocs(root: string): Promise<ClaudeDocScan> {
  const found: string[] = [];
  const dangling: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (INSTRUCTION_WALK_SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === CLAUDE_MD) found.push(path);
      else if (entry.isSymbolicLink() && entry.name === AGENTS_MD && !(await targetExists(path))) dangling.push(path);
    }
  };
  await visit(root);
  return { claudeDocs: found, danglingMirrors: dangling };
}

async function targetExists(linkPath: string): Promise<boolean> {
  try {
    await stat(linkPath);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

/**
 * Plant (or repair) the `AGENTS.md` symlink beside one `CLAUDE.md`. Returns the
 * mirror path if it changed, else null.
 *
 * Exported for callers that create a single CLAUDE.md and know exactly which
 * one — the map finalize step, which would otherwise have to re-walk the whole
 * package and touch every other mirrored surface to link one file.
 */
export async function ensureAgentsMirror(claudePath: string): Promise<string | null> {
  const agentsPath = join(dirname(claudePath), AGENTS_MD);
  if (await pathKind(agentsPath) === "file") {
    const content = await readFile(agentsPath, "utf8");
    if (isLegacyGeneratedAgentsFile(content)) await rm(agentsPath);
  }
  return await ensureRelativeSymlink(agentsPath, claudePath) ? agentsPath : null;
}

async function mirrorClaudeDocs(boxRoot: string): Promise<string[]> {
  const changed: string[] = [];
  const { claudeDocs, danglingMirrors } = await findClaudeDocs(boxRoot);
  for (const claudePath of claudeDocs) {
    const mirror = await ensureAgentsMirror(claudePath);
    if (mirror !== null) changed.push(mirror);
  }
  // A `CLAUDE.md` that was removed leaves its mirror pointing at nothing;
  // Codex would list a guide that no longer exists.
  for (const link of danglingMirrors) {
    await rm(link);
    changed.push(link);
  }
  return changed;
}

async function mirrorSkills(boxRoot: string): Promise<string[]> {
  const sourceDir = join(boxRoot, ".claude", "skills");
  const targetDir = join(boxRoot, ".agents", "skills");
  await mkdir(targetDir, { recursive: true });
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  const changed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const linkPath = join(targetDir, entry.name);
    if (await ensureRelativeSymlink(linkPath, join(sourceDir, entry.name))) changed.push(linkPath);
  }
  return [...changed, ...await pruneDanglingSkillLinks(targetDir, sourceDir)];
}

/**
 * Remove `.agents/skills/<name>` symlinks into `.claude/skills/` whose target
 * is gone (a managed skill was retired or renamed). A symlink has no first
 * line to mark, so dangling is the orphan test; a link pointing anywhere else
 * is not ours and stays.
 */
async function pruneDanglingSkillLinks(targetDir: string, sourceDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const entry of await readdir(targetDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const linkPath = join(targetDir, entry.name);
    const target = await readlink(linkPath);
    if (target !== relative(targetDir, join(sourceDir, entry.name))) continue;
    try {
      await stat(linkPath);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      await rm(linkPath);
      removed.push(linkPath);
    }
  }
  return removed;
}

async function mirrorCodexHooks(boxRoot: string): Promise<string[]> {
  const hooksPath = join(boxRoot, ".codex", "hooks.json");
  const description = "GENERATED from Bee Box's Codex plugin hooks; do not edit.";
  const content = `${JSON.stringify({
    description,
    hooks: {
      SessionStart: [{ hooks: [{
        type: "command",
        command: "\"$CLAUDE_PROJECT_DIR/node_modules/beebox/plugins/beebox-codex/scripts/run-bbx.sh\" agent-context --hook",
        statusMessage: "Loading Bee Box context",
      }] }],
      PostToolUse: [{
        matcher: "apply_patch|Edit|Write",
        hooks: [{
          type: "command",
          command: "\"$CLAUDE_PROJECT_DIR/node_modules/beebox/plugins/beebox-codex/scripts/run-bbx.sh\" validate --hook",
          statusMessage: "Validating box files",
        }],
      }],
    },
  }, null, 2)}\n`;
  const kind = await pathKind(hooksPath);
  if (kind === "file") {
    const current = await readFile(hooksPath, "utf8");
    if (!current.includes(description) || current === content) return [];
  }
  if (kind === "directory") return [];
  if (kind === "symlink" || kind === "file") await rm(hooksPath);
  await mkdir(dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, content);
  return [hooksPath];
}

function ruleSkill(ruleName: string, rule: string): string {
  const unmarked = withoutDocId(rule);
  const frontmatter = /^---\n([\S\s]*?)\n---\n+/.exec(unmarked)?.[1] ?? "";
  const paths = [...frontmatter.matchAll(/^\s*-\s+["']?(.+?)["']?\s*$/gm)]
    .map((match) => match[1])
    .join(", ");
  const body = unmarked.replace(/^---\n[\S\s]*?\n---\n+/, "");
  const selector = paths === "" ? "relevant box files" : paths;
  return withDocId({
    relativePath: `.agents/skills/beebox-rule-${ruleName}/SKILL.md`,
    content: `---\nname: beebox-rule-${ruleName}\ndescription: Apply Bee Box's ${ruleName} rules when working with ${selector}.\n---\n\nApplies to: ${selector}\n\n${body.trim()}\n`,
  });
}

async function mirrorRules(boxRoot: string): Promise<string[]> {
  const rulesDir = join(boxRoot, ".claude", "rules");
  const skillsDir = join(boxRoot, ".agents", "skills");
  let files: string[];
  try {
    files = (await readdir(rulesDir)).filter((file) => file.endsWith(".md"));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  const changed: string[] = [];
  const expected = new Set(files.map((file) => `beebox-rule-${file.slice(0, -3)}`));
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    const managed = entry.name.startsWith("beebox-rule-") || entry.name.startsWith("callback-box-rule-");
    if (entry.isDirectory() && managed && !expected.has(entry.name)) {
      await rm(join(skillsDir, entry.name), { recursive: true });
      changed.push(join(skillsDir, entry.name));
    }
  }
  for (const file of files) {
    const ruleName = file.slice(0, -3);
    const target = join(boxRoot, ".agents", "skills", `beebox-rule-${ruleName}`, "SKILL.md");
    const content = ruleSkill(ruleName, await readFile(join(rulesDir, file), "utf8"));
    await mkdir(dirname(target), { recursive: true });
    let previous: string | undefined;
    try { previous = await readFile(target, "utf8"); } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    if (previous !== content) {
      await writeFile(target, content);
      changed.push(target);
    }
  }
  return changed;
}

/**
 * CLAUDE.md and Claude skills remain canonical and editable. Codex sees them
 * through symlinks; Claude-only path rules are copied into generated Codex
 * skills because Codex plugins have no rules component.
 */
export async function generateAgentContextMirrors(boxRoot: string): Promise<string[]> {
  const shape = await getBoxShape(boxRoot);
  return [
    ...await mirrorClaudeDocs(shape.boxRoot),
    ...await mirrorSkills(shape.boxRoot),
    ...await mirrorRules(shape.boxRoot),
    ...await mirrorCodexHooks(shape.boxRoot),
  ];
}
