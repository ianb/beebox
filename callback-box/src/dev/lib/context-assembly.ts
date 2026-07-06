/**
 * Context assembly — build the complete context a box agent receives in a
 * given situation, layer by layer, so the whole stack can be reviewed as one
 * document (see `pnpm agent-context`, src/dev/agent-context.ts).
 *
 * Box-generated layers (CLAUDE.md and its @-includes, skills, rules) are read
 * from the box's disk — that is what the agent actually loads, so a stale
 * `cb init` shows up honestly here rather than being papered over. System
 * prompts come from source. Per-turn dynamic content (the `<chat-app>`
 * snapshot, selections, attachments) is inherently per-message and is noted,
 * not rendered.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHAT_SYSTEM_PROMPT,
  NARRATION_OVERLAY,
  buildLandmarkSessionNote,
} from "../../core/chat/session/prompts.js";
import { buildThreadSystemPrompt } from "../../core/chat/session/thread.js";
import {
  buildReactorSystemPrompt,
  buildReactorUserPrompt,
} from "../../core/reactor/prompts.js";
import { createCardSchemaMap } from "../../schemas/registry.js";

/** How a layer reaches the agent's context. */
export type LayerLoading = "always" | "situational" | "on-demand";

export interface ContextLayer {
  name: string;
  /** Where the text comes from (source file or box path). */
  source: string;
  loading: LayerLoading;
  text: string;
}

export interface AssembledContext {
  situation: string;
  description: string;
  boxRoot: string;
  layers: ContextLayer[];
  /** Dynamic content that exists in the situation but can't be rendered statically. */
  notRendered: string[];
}

export interface AssembleOptions {
  boxRoot: string;
  /** Inline this installed skill's body as an on-demand layer. */
  skill?: string | undefined;
  /** Include this card type's schema instructions (reactor: rides the job; chat: rules-loaded). */
  cardType?: string | undefined;
  /** Chat only: scope the session to this landmark directory. */
  landmarkDir?: string | undefined;
}

export const SITUATIONS: Record<string, string> = {
  chat: "The web-UI chat session (voice or typed), run in the box cwd.",
  "chat-thread": "A per-thread chat session (e.g. Telegram), one process per thread.",
  reactor: "A batch job-processing session spawned by the reactor during wakeup.",
};

export async function assembleContext(
  situation: string,
  options: AssembleOptions,
): Promise<AssembledContext> {
  const description = SITUATIONS[situation];
  if (description === undefined) {
    throw new UnknownSituationError(situation);
  }
  const { boxRoot } = options;
  const layers: ContextLayer[] = [];
  const notRendered: string[] = [];

  layers.push(...(await systemPromptLayers(situation, options)));
  layers.push(await claudeMdLayer(boxRoot));
  layers.push(await skillDescriptionsLayer(boxRoot));
  layers.push(await rulesInventoryLayer(boxRoot));

  if (options.skill !== undefined) {
    layers.push(await skillBodyLayer(boxRoot, options.skill));
  }
  if (options.cardType !== undefined) {
    layers.push(await schemaInstructionsLayer(boxRoot, options.cardType));
  }

  if (situation === "chat" || situation === "chat-thread") {
    notRendered.push(
      "Per-message: the `<chat-app>` state snapshot, `<user-selection>` blocks, `<attachments>` blocks (see session-context.ts / chat-session-prompts.ts).",
    );
  }
  if (situation === "reactor") {
    notRendered.push(
      "Per-run: the actual job descriptions (job card content + inlined refs + schema instructions) interpolated into the user prompt.",
    );
  }

  return { situation, description, boxRoot, layers, notRendered };
}

class UnknownSituationError extends Error {
  constructor(situation: string) {
    const known = Object.keys(SITUATIONS).join(", ");
    super(`Unknown situation "${situation}" (known: ${known})`);
    this.name = "UnknownSituationError";
  }
}

class SkillNotInstalledError extends Error {
  constructor(skill: string, path: string) {
    super(`Skill "${skill}" is not installed at ${path} (run cb init?)`);
    this.name = "SkillNotInstalledError";
  }
}

class UnknownCardTypeError extends Error {
  constructor(cardType: string, known: string[]) {
    super(`Unknown card type "${cardType}" (known: ${known.join(", ")})`);
    this.name = "UnknownCardTypeError";
  }
}

async function systemPromptLayers(
  situation: string,
  options: AssembleOptions,
): Promise<ContextLayer[]> {
  if (situation === "chat") {
    let text = CHAT_SYSTEM_PROMPT + NARRATION_OVERLAY;
    if (options.landmarkDir !== undefined) {
      text += buildLandmarkSessionNote(options.landmarkDir);
    }
    return [{
      name: "Chat system prompt",
      source: "src/core/chat/session/prompts.ts",
      loading: "always",
      text,
    }];
  }
  if (situation === "chat-thread") {
    return [{
      name: "Chat-thread system prompt (placeholders unexpanded)",
      source: "src/core/chat/session/thread.ts",
      loading: "always",
      text: buildThreadSystemPrompt({
        threadRef: "${threadRef}",
        chatDescription: "${chatDescription}",
        sessionViewBaseUrl: "${sessionViewBaseUrl}",
      }),
    }];
  }
  // reactor
  return [
    {
      name: "Reactor system prompt",
      source: "src/core/reactor/prompts.ts",
      loading: "always",
      text: buildReactorSystemPrompt(options.boxRoot),
    },
    {
      name: "Reactor user prompt (template)",
      source: "src/core/reactor/prompts.ts",
      loading: "situational",
      text: buildReactorUserPrompt(["<job-path>"], ["<job-description>"]),
    },
  ];
}

/** Box CLAUDE.md with one level of `@path` includes inlined. */
async function claudeMdLayer(boxRoot: string): Promise<ContextLayer> {
  const raw = await readFile(join(boxRoot, "CLAUDE.md"), "utf-8");
  const parts: string[] = [];
  for (const line of raw.split("\n")) {
    const include = line.match(/^@(\S+)\s*$/);
    if (!include) {
      parts.push(line);
      continue;
    }
    const includePath = include[1]!;
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
 * The always-loaded routing surface of skills: each installed skill's name and
 * trigger description (the body loads only on invocation).
 */
async function skillDescriptionsLayer(boxRoot: string): Promise<ContextLayer> {
  const skillsDir = join(boxRoot, ".claude", "skills");
  const lines: string[] = [];
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

async function skillBodyLayer(boxRoot: string, skill: string): Promise<ContextLayer> {
  const path = join(boxRoot, ".claude", "skills", skill, "SKILL.md");
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (_e) {
    throw new SkillNotInstalledError(skill, path);
  }
  return {
    name: `Skill body: ${skill} (loads when invoked)`,
    source: path,
    loading: "on-demand",
    text,
  };
}

/** Inventory of .claude/rules/ — each loads when the agent touches a matching path. */
async function rulesInventoryLayer(boxRoot: string): Promise<ContextLayer> {
  const rulesDir = join(boxRoot, ".claude", "rules");
  const lines: string[] = [];
  for (const file of await listDir(rulesDir)) {
    if (!file.endsWith(".md")) continue;
    const path = join(rulesDir, file);
    const content = await readFile(path, "utf-8");
    const paths = [...content.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
    const scope = paths.length > 0 ? paths.join(", ") : "(no paths declared)";
    lines.push(`- \`${file}\` — ${String(wordCount(content))} words — loads on: ${scope}`);
  }
  return {
    name: "Rules inventory (each loads on path match, not up front)",
    source: join(boxRoot, ".claude/rules/"),
    loading: "on-demand",
    text: lines.length > 0 ? lines.join("\n") : "(no rules installed)",
  };
}

async function schemaInstructionsLayer(boxRoot: string, cardType: string): Promise<ContextLayer> {
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
  return match ? match[1]!.trim() : null;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
