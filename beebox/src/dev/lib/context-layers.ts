/**
 * Box-sourced context layers for `assembleContext` (context-assembly.ts) —
 * everything read from a box's disk rather than from source code.
 *
 * shapeVersion 3: a box has ONE root — `.claude/` (skills, rules, memory) and
 * CLAUDE.md all live at `boxRoot`. Every layer builder here takes that one
 * root.
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

class SkillNotInstalledError extends Error {
  constructor(skill: string, paths: string[]) {
    super(`Skill "${skill}" is not installed at ${paths.join(" or ")} (run bbx init?)`);
    this.name = "SkillNotInstalledError";
  }
}

class UnknownCardTypeError extends Error {
  constructor(cardType: string, known: string[]) {
    super(`Unknown card type "${cardType}" (known: ${known.join(", ")})`);
    this.name = "UnknownCardTypeError";
  }
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
 * The auto-memory index — `bbx init` symlinks the box's `.claude/memory/` as
 * Claude Code's project memory, so MEMORY.md loads every session. Null when
 * the box has no memory index.
 */
export async function memoryLayer(boxRoot: string): Promise<ContextLayer | null> {
  const path = join(boxRoot, ".claude", "memory", "MEMORY.md");
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
export async function skillDescriptionsLayer(boxRoot: string): Promise<ContextLayer> {
  const lines: string[] = [];
  const skillsDir = join(boxRoot, ".claude", "skills");
  for (const name of await listDir(skillsDir)) {
    const description = await skillDescription(join(skillsDir, name, "SKILL.md"));
    lines.push(`- **${name}** — ${description ?? "(no description)"}`);
  }
  return {
    name: "Skill descriptions (routing surface; bodies load on invocation)",
    source: join(boxRoot, ".claude/skills/*/SKILL.md"),
    loading: "always",
    text: lines.length > 0 ? lines.join("\n") : "(no skills installed)",
  };
}

export async function skillBodyLayer(boxRoot: string, skill: string): Promise<ContextLayer> {
  const path = join(boxRoot, ".claude", "skills", skill, "SKILL.md");
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (_e) {
    throw new SkillNotInstalledError(skill, [path]);
  }
  return {
    name: `Skill body: ${skill} (loads when invoked)`,
    source: path,
    loading: "on-demand",
    text,
  };
}

/** Inventory of `.claude/rules/` — each loads when the agent touches a matching path. */
export async function rulesInventoryLayer(boxRoot: string): Promise<ContextLayer> {
  const lines: string[] = [];
  const rulesDir = join(boxRoot, ".claude", "rules");
  const label = relative(boxRoot, rulesDir) || rulesDir;
  for (const file of await listDir(rulesDir)) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(rulesDir, file), "utf-8");
    const paths = [...content.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
    const scope = paths.length > 0 ? paths.join(", ") : "(no paths declared)";
    lines.push(`- \`${label}/${file}\` — ${String(wordCount(content))} words — loads on: ${scope}`);
  }
  return {
    name: "Rules inventory (each loads on path match, not up front)",
    source: join(boxRoot, ".claude/rules/"),
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
    source: `src/schemas/ (or _config/schemas/) → ${cardType}`,
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
