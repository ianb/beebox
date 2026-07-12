/**
 * Box-sourced context layers for `assembleContext` (context-assembly.ts) —
 * everything read from a box's disk rather than from source code.
 *
 * A v2 (package-shaped) box splits its always-loaded surface across two
 * roots: Claude Code runs in the operational root (`content/`), whose
 * CLAUDE.md is the operating context, but `.claude/` (skills, rules, memory)
 * lives at the PACKAGE root, and the package root's own CLAUDE.md also loads
 * (Claude Code reads CLAUDE.md from the cwd and its ancestors). Every layer
 * builder here therefore takes the roots it actually reads from. For a
 * legacy box the two roots are the same directory.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { invariant } from "../../lib/invariant.js";

/** How a layer reaches the agent's context. */
export type LayerLoading = "always" | "situational" | "on-demand";

export interface ContextLayer {
  name: string;
  /** Where the text comes from (source file or box path). */
  source: string;
  loading: LayerLoading;
  text: string;
}

export interface BoxRoots {
  /** The operational root — where the agent session actually runs. */
  boxRoot: string;
  /** The package root — where `.claude/` lives. Equals boxRoot for legacy boxes. */
  packageRoot: string;
}

class SkillNotInstalledError extends Error {
  constructor(skill: string, paths: string[]) {
    super(`Skill "${skill}" is not installed at ${paths.join(" or ")} (run cb init?)`);
    this.name = "SkillNotInstalledError";
  }
}

class UnknownCardTypeError extends Error {
  constructor(cardType: string, known: string[]) {
    super(`Unknown card type "${cardType}" (known: ${known.join(", ")})`);
    this.name = "UnknownCardTypeError";
  }
}

/** Distinct `.claude/` roots to scan, package root first. */
function claudeRoots(roots: BoxRoots): string[] {
  return roots.packageRoot === roots.boxRoot
    ? [roots.packageRoot]
    : [roots.packageRoot, roots.boxRoot];
}

/**
 * The package root's own CLAUDE.md — a separate always-loaded layer for a v2
 * box (Claude Code loads every CLAUDE.md from the cwd up). Null when the box
 * is legacy-shaped or the package root has no CLAUDE.md.
 */
export async function packageClaudeMdLayer(roots: BoxRoots): Promise<ContextLayer | null> {
  if (roots.packageRoot === roots.boxRoot) return null;
  const path = join(roots.packageRoot, "CLAUDE.md");
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (_e) {
    // No package-level CLAUDE.md — nothing to load.
    return null;
  }
  return {
    name: "Package CLAUDE.md (box repo root; loads alongside the operational CLAUDE.md)",
    source: path,
    loading: "always",
    text,
  };
}

/** Operational-root CLAUDE.md with one level of `@path` includes inlined. */
export async function claudeMdLayer(boxRoot: string): Promise<ContextLayer> {
  const raw = await readFile(join(boxRoot, "CLAUDE.md"), "utf-8");
  const parts: string[] = [];
  for (const line of raw.split("\n")) {
    const include = line.match(/^@(\S+)\s*$/);
    if (!include) {
      parts.push(line);
      continue;
    }
    const includePath = include[1];
    invariant(includePath !== undefined, "regex match must populate its required capture group");
    try {
      const included = await readFile(join(boxRoot, includePath), "utf-8");
      parts.push(`<!-- ─── @${includePath} ─── -->`, included.trimEnd(), `<!-- ─── end @${includePath} ─── -->`);
    } catch (_e) {
      // Missing include: keep the line visible so the report shows the hole.
      parts.push(`${line}  <!-- UNRESOLVED: file not found -->`);
    }
  }
  return {
    name: "Box CLAUDE.md (@-includes inlined: briefing, agent guide, maps)",
    source: join(boxRoot, "CLAUDE.md"),
    loading: "always",
    text: parts.join("\n"),
  };
}

/**
 * The auto-memory index — `cb init` symlinks the box's `.claude/memory/` as
 * Claude Code's project memory, so MEMORY.md loads every session. Null when
 * the box has no memory index.
 */
export async function memoryLayer(roots: BoxRoots): Promise<ContextLayer | null> {
  const path = join(roots.packageRoot, ".claude", "memory", "MEMORY.md");
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (_e) {
    // No memory index — the box has never saved a memory.
    return null;
  }
  return {
    name: "Memory index (auto-memory MEMORY.md; entries load on demand)",
    source: path,
    loading: "always",
    text,
  };
}

/**
 * The always-loaded routing surface of skills: each installed skill's name and
 * trigger description (the body loads only on invocation).
 */
export async function skillDescriptionsLayer(roots: BoxRoots): Promise<ContextLayer> {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const root of claudeRoots(roots)) {
    const skillsDir = join(root, ".claude", "skills");
    for (const name of await listDir(skillsDir)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const description = await skillDescription(join(skillsDir, name, "SKILL.md"));
      lines.push(`- **${name}** — ${description ?? "(no description)"}`);
    }
  }
  return {
    name: "Skill descriptions (routing surface; bodies load on invocation)",
    source: join(roots.packageRoot, ".claude/skills/*/SKILL.md"),
    loading: "always",
    text: lines.length > 0 ? lines.join("\n") : "(no skills installed)",
  };
}

export async function skillBodyLayer(roots: BoxRoots, skill: string): Promise<ContextLayer> {
  const candidates = claudeRoots(roots).map((root) =>
    join(root, ".claude", "skills", skill, "SKILL.md"),
  );
  for (const path of candidates) {
    let text: string;
    try {
      text = await readFile(path, "utf-8");
    } catch (_e) {
      continue;
    }
    return {
      name: `Skill body: ${skill} (loads when invoked)`,
      source: path,
      loading: "on-demand",
      text,
    };
  }
  throw new SkillNotInstalledError(skill, candidates);
}

/** Inventory of `.claude/rules/` (both roots) — each loads when the agent touches a matching path. */
export async function rulesInventoryLayer(roots: BoxRoots): Promise<ContextLayer> {
  const lines: string[] = [];
  for (const root of claudeRoots(roots)) {
    const rulesDir = join(root, ".claude", "rules");
    const label = relative(roots.packageRoot, rulesDir) || rulesDir;
    for (const file of await listDir(rulesDir)) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(rulesDir, file), "utf-8");
      const paths = [...content.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
      const scope = paths.length > 0 ? paths.join(", ") : "(no paths declared)";
      lines.push(`- \`${label}/${file}\` — ${String(wordCount(content))} words — loads on: ${scope}`);
    }
  }
  return {
    name: "Rules inventory (each loads on path match, not up front)",
    source: join(roots.packageRoot, ".claude/rules/"),
    loading: "on-demand",
    text: lines.length > 0 ? lines.join("\n") : "(no rules installed)",
  };
}

export async function schemaInstructionsLayer(boxRoot: string, cardType: string): Promise<ContextLayer> {
  const map = await createCardSchemaMap(boxRoot);
  const schema = map.get(cardType);
  if (!schema) {
    throw new UnknownCardTypeError(cardType, [...map.keys()]);
  }
  return {
    name: `Schema instructions: ${cardType} (rides the job / loads via card rule)`,
    source: `src/schemas/ (or config/schemas/) → ${cardType}`,
    loading: "situational",
    text: schema.instructions ?? "(this type has no instructions)",
  };
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).toSorted();
  } catch (_e) {
    // Directory absent (e.g. box has no skills/rules yet) — an empty layer, not an error.
    return [];
  }
}

async function skillDescription(path: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (_e) {
    return null;
  }
  const match = content.match(/^description:\s*(.+)$/m);
  if (!match) return null;
  const description = match[1];
  invariant(description !== undefined, "regex match must populate its required capture group");
  return description.trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
