/**
 * The skill names `bin/skill-usage.ts` counts, and how a name found in a
 * transcript maps onto one of them.
 *
 * Repo skills come from the skills directory plus whatever `HEAD` still tracks
 * there (so a skill deleted in the working tree is still measured). Git history
 * supplies the rest: a renamed skill's old name (`cb-debug`) counts toward its
 * current name, and a deleted one is reported as retired. User skills are the
 * directories under `~/.claude/skills/`, including the synced plugin bucket.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type SkillCategory = "repo" | "retired" | "user" | "harness" | "other";
export type MentionForm = "bare" | "slash" | "dollar" | "path";

/** Harness skills seen in this repo's sessions. Unknown names (box guidance skills, plugins) are "other". */
const HARNESS_SKILLS = [
  "code-review", "simplify", "loop", "schedule", "claude-api", "init", "security-review",
  "fewer-permission-prompts", "update-config", "keybindings-help", "run", "dataviz",
  "plugin-authoring", "workflow-authoring", "review", "claude-in-chrome", "artifact-design",
];

export interface SkillCatalog {
  repo: string[];
  retired: string[];
  user: string[];
  harness: string[];
  /** Old repo skill name → current name. */
  aliases: Map<string, string>;
}

function dirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    if (error instanceof Error) return "";
    throw error;
  }
}

/** Old→new renames and plain deletions of `<rel>/<name>/SKILL.md` across history. */
function skillHistory(repoRoot: string, rel: string): { renames: Map<string, string>; deleted: Set<string> } {
  const renames = new Map<string, string>();
  const deleted = new Set<string>();
  const nameOf = (p: string): string | null => {
    const prefix = `${rel}/`;
    if (!p.startsWith(prefix) || !p.endsWith("/SKILL.md")) return null;
    const middle = p.slice(prefix.length, -"/SKILL.md".length);
    return middle && !middle.includes("/") ? middle : null;
  };
  const log = git(repoRoot, ["log", "-M", "--diff-filter=RD", "--name-status", "--format=", "--", `${rel}/*/SKILL.md`]);
  for (const line of log.split("\n")) {
    const [status, from, to] = line.split("\t");
    const oldName = from ? nameOf(from) : null;
    if (!status || !oldName) continue;
    const newName = to ? nameOf(to) : null;
    if (status.startsWith("R") && newName && newName !== oldName) renames.set(oldName, newName);
    else if (status === "D") deleted.add(oldName);
  }
  return { renames, deleted };
}

export function loadCatalog(opts: { skillsDir: string; home: string }): SkillCatalog {
  const skillsDir = path.resolve(opts.skillsDir);
  const repoRoot = git(skillsDir, ["rev-parse", "--show-toplevel"]).trim();
  const current = new Set(dirNames(skillsDir));
  const aliases = new Map<string, string>();
  const retired = new Set<string>();
  if (repoRoot) {
    const rel = path.relative(repoRoot, skillsDir);
    for (const line of git(repoRoot, ["ls-tree", "--name-only", "HEAD", `${rel}/`]).split("\n")) {
      if (line) current.add(path.basename(line));
    }
    const { renames, deleted } = skillHistory(repoRoot, rel);
    for (const [from] of renames) {
      let to = from;
      for (let hops = 0; renames.has(to) && hops < 10; hops++) to = renames.get(to) ?? to;
      if (current.has(to)) aliases.set(from, to);
    }
    for (const name of deleted) if (!current.has(name) && !aliases.has(name)) retired.add(name);
  }
  const userRoot = path.join(opts.home, ".claude", "skills");
  const user = dirNames(userRoot).filter((n) => n !== "synced");
  for (const bucket of dirNames(path.join(userRoot, "synced"))) user.push(...dirNames(path.join(userRoot, "synced", bucket)));
  return { repo: [...current].toSorted(), retired: [...retired].toSorted(), user: [...new Set(user)].toSorted(), harness: HARNESS_SKILLS, aliases };
}

/** Current name for a transcript name: strips a plugin prefix, follows renames. */
export function canonical(catalog: SkillCatalog, raw: string): string {
  const name = raw.replace(/^\//, "").trim();
  const bare = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  const known = (n: string): boolean => catalog.repo.includes(n) || catalog.user.includes(n);
  if (known(bare)) return bare;
  return catalog.aliases.get(name) ?? catalog.aliases.get(bare) ?? name;
}

export function categoryOf(catalog: SkillCatalog, name: string): SkillCategory {
  if (catalog.repo.includes(name)) return "repo";
  if (catalog.retired.includes(name)) return "retired";
  if (catalog.user.includes(name)) return "user";
  return catalog.harness.includes(name) ? "harness" : "other";
}

/**
 * Candidate-name scanners, one per form. Each captures a token that is then
 * looked up by name, so no regex is built from data. A single-word name
 * (`finish`, `issues`, `browse`) is also an ordinary word, so its bare form
 * only counts next to the word "skill"; hyphenated names count anywhere.
 */
const FORM_SCANNERS: [MentionForm, RegExp][] = [
  ["path", /skills\/([\w-]+)/g],
  ["slash", /(?:^|[\s"'(`])\/([a-z][\w:-]*)(?![\w/])/gi],
  ["dollar", /(?:^|[\s"'(`])\$([a-z][\w:-]*)(?![\w/])/gi],
  ["bare", /(?<![\w$./-])([a-z][\da-z]*(?:-[\da-z]+)+)(?![\w-])/gi],
  ["bare", /(?<![\w$./-])`?([a-z][\da-z-]*)`? skill\b/gi],
  ["bare", /\bskills? (?:called )?`?([a-z][\da-z-]*)`?(?![\w-])/gi],
];

/** Every name a mention can resolve to, keyed by its spelling in prose. */
export function mentionNames(catalog: SkillCatalog): Map<string, string> {
  const names = new Map<string, string>();
  for (const raw of [...catalog.repo, ...catalog.retired, ...catalog.user, ...catalog.aliases.keys()]) {
    names.set(raw.toLowerCase(), canonical(catalog, raw));
  }
  return names;
}

/** Which skills a briefing mentions, and in which forms. */
export function findMentions(text: string, names: Map<string, string>): Map<string, Set<MentionForm>> {
  const found = new Map<string, Set<MentionForm>>();
  for (const [form, re] of FORM_SCANNERS) {
    for (const m of text.matchAll(re)) {
      const raw = (m[1] ?? "").toLowerCase();
      const name = names.get(raw) ?? names.get(raw.slice(raw.indexOf(":") + 1));
      if (!name) continue;
      const forms = found.get(name) ?? new Set<MentionForm>();
      forms.add(form);
      found.set(name, forms);
    }
  }
  return found;
}
