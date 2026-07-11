#!/usr/bin/env tsx
/**
 * Agent Context — render the complete context a box agent receives in a given
 * situation, layer by layer, as one reviewable markdown document.
 *
 * Usage:
 *   pnpm agent-context chat --box ~/src/boxes/test1
 *   pnpm agent-context reactor --box ~/src/boxes/test1 --card-type recipe
 *   pnpm agent-context chat --box ~/src/boxes/test1 --skill calendar --output /tmp/ctx.md
 *   pnpm agent-context --list
 *
 * How to use this for prompt review: see the cb-prompt-review skill
 * (monorepo .claude/skills/cb-prompt-review/SKILL.md).
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assembleContext,
  SITUATIONS,
  wordCount,
  type AssembledContext,
} from "./lib/context-assembly.js";
import { invariant } from "../lib/invariant.js";

function usage(): never {
  console.error("Usage: pnpm agent-context <situation> --box <path> [--skill <name>] [--card-type <type>] [--landmark <dir>] [--output <file>]");
  console.error("       pnpm agent-context --list");
  process.exit(1);
}

function listSituations(): never {
  for (const [name, description] of Object.entries(SITUATIONS)) {
    console.log(`${name} — ${description}`);
  }
  process.exit(0);
}

function fence(text: string): string {
  const marker = text.includes("````") ? "`````" : "````";
  return `${marker}\n${text}\n${marker}`;
}

function renderReport(ctx: AssembledContext): string {
  const lines: string[] = [];
  lines.push(`# Agent context — ${ctx.situation}`);
  lines.push("");
  lines.push(`${ctx.description}`);
  lines.push("");
  lines.push(`Box: \`${ctx.boxRoot}\``);
  lines.push("");
  lines.push("| # | Layer | Loading | Words |");
  lines.push("|---|-------|---------|-------|");
  let alwaysWords = 0;
  for (const [i, layer] of ctx.layers.entries()) {
    const words = wordCount(layer.text);
    if (layer.loading === "always") alwaysWords += words;
    lines.push(`| ${String(i + 1)} | ${layer.name} | ${layer.loading} | ${String(words)} |`);
  }
  lines.push("");
  lines.push(`**Always-loaded total: ~${alwaysWords.toLocaleString()} words.** Situational/on-demand layers cost nothing until their trigger fires — but their *triggers* (skill descriptions, rule globs) are part of the always-loaded weight above.`);
  lines.push("");
  if (ctx.notRendered.length > 0) {
    lines.push("**Not rendered (dynamic, per-turn):**");
    for (const note of ctx.notRendered) lines.push(`- ${note}`);
    lines.push("");
  }
  for (const [i, layer] of ctx.layers.entries()) {
    lines.push("---");
    lines.push("");
    lines.push(`## ${String(i + 1)}. ${layer.name}`);
    lines.push("");
    lines.push(`**Source:** \`${layer.source}\` · **Loading:** ${layer.loading} · **Words:** ${String(wordCount(layer.text))}`);
    lines.push("");
    lines.push(fence(layer.text));
    lines.push("");
  }
  return lines.join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--list")) listSituations();

let situation: string | null = null;
let boxRoot: string | null = null;
let skill: string | undefined;
let cardType: string | undefined;
let landmarkDir: string | undefined;
let output: string | null = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  invariant(arg !== undefined, `args[${i}] must exist for 0 <= i < args.length`);
  if (arg === "--box") { boxRoot = args[++i] ?? null; }
  else if (arg === "--skill") { skill = args[++i]; }
  else if (arg === "--card-type") { cardType = args[++i]; }
  else if (arg === "--landmark") { landmarkDir = args[++i]; }
  else if (arg === "--output") { output = args[++i] ?? null; }
  else if (arg.startsWith("--")) { console.error(`Unknown flag: ${arg}`); usage(); }
  else if (situation === null) { situation = arg; }
  else { console.error(`Unexpected argument: ${arg}`); usage(); }
}

if (situation === null || boxRoot === null) usage();

const ctx = await assembleContext(situation, {
  boxRoot: resolve(boxRoot),
  skill,
  cardType,
  landmarkDir,
});
const report = renderReport(ctx);

if (output !== null) {
  await writeFile(resolve(output), report);
  console.log(`Wrote ${resolve(output)}`);
} else {
  console.log(report);
}
