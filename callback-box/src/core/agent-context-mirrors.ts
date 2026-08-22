/** Materialize the editable Claude-authored context for Codex. */

import { dirname, join, relative } from "node:path";
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { errnoCode } from "../lib/error-guards.js";
import { getBoxShape } from "../lib/box-shape.js";
import { AGENTS_MD, CLAUDE_MD } from "./agent-instruction-files.js";

const GENERATED_AGENTS_MARKER = "GENERATED from Claude guidance";

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

async function findClaudeDocs(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".agents") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === CLAUDE_MD) found.push(path);
    }
  };
  await visit(root);
  return found;
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
    if (content.includes(GENERATED_AGENTS_MARKER)) await rm(agentsPath);
  }
  return await ensureRelativeSymlink(agentsPath, claudePath) ? agentsPath : null;
}

async function mirrorClaudeDocs(packageRoot: string): Promise<string[]> {
  const changed: string[] = [];
  for (const claudePath of await findClaudeDocs(packageRoot)) {
    const mirror = await ensureAgentsMirror(claudePath);
    if (mirror !== null) changed.push(mirror);
  }
  return changed;
}

async function mirrorSkills(packageRoot: string): Promise<string[]> {
  const sourceDir = join(packageRoot, ".claude", "skills");
  const targetDir = join(packageRoot, ".agents", "skills");
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
  return changed;
}

async function mirrorCodexHooks(packageRoot: string): Promise<string[]> {
  const linkPath = join(packageRoot, ".codex", "hooks.json");
  const targetPath = join(
    packageRoot,
    "node_modules",
    "callback-box",
    "plugins",
    "callback-box-codex",
    "hooks",
    "hooks.json",
  );
  return await ensureRelativeSymlink(linkPath, targetPath) ? [linkPath] : [];
}

function ruleSkill(ruleName: string, rule: string): string {
  const frontmatter = /^---\n([\S\s]*?)\n---\n+/.exec(rule)?.[1] ?? "";
  const paths = [...frontmatter.matchAll(/^\s*-\s+["']?(.+?)["']?\s*$/gm)]
    .map((match) => match[1])
    .join(", ");
  const body = rule.replace(/^---\n[\S\s]*?\n---\n+/, "");
  const selector = paths === "" ? "relevant box files" : paths;
  return `---\nname: callback-box-rule-${ruleName}\ndescription: Apply Callback Box's ${ruleName} rules when working with ${selector}.\n---\n\nApplies to: ${selector}\n\n${body.trim()}\n`;
}

async function mirrorRules(packageRoot: string): Promise<string[]> {
  const rulesDir = join(packageRoot, ".claude", "rules");
  const skillsDir = join(packageRoot, ".agents", "skills");
  let files: string[];
  try {
    files = (await readdir(rulesDir)).filter((file) => file.endsWith(".md"));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  const changed: string[] = [];
  const expected = new Set(files.map((file) => `callback-box-rule-${file.slice(0, -3)}`));
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("callback-box-rule-") && !expected.has(entry.name)) {
      await rm(join(skillsDir, entry.name), { recursive: true });
      changed.push(join(skillsDir, entry.name));
    }
  }
  for (const file of files) {
    const ruleName = file.slice(0, -3);
    const target = join(packageRoot, ".agents", "skills", `callback-box-rule-${ruleName}`, "SKILL.md");
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
  const { packageRoot } = await getBoxShape(boxRoot);
  return [
    ...await mirrorClaudeDocs(packageRoot),
    ...await mirrorSkills(packageRoot),
    ...await mirrorRules(packageRoot),
    ...await mirrorCodexHooks(packageRoot),
  ];
}
