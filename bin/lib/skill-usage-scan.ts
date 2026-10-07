/**
 * Shared plumbing for the Claude and Codex transcript scanners behind
 * `bin/skill-usage.ts`: JSONL streaming, shape guards, and the scan context.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import { findMentions, type SkillCatalog } from "./skill-usage-catalog.ts";
import type { BriefingVia, Source, UsageStats } from "./skill-usage-stats.ts";

export interface ScanContext {
  catalog: SkillCatalog;
  /** Prose spelling → canonical skill name, for briefing mentions. */
  mentionNames: Map<string, string>;
  stats: UsageStats;
  sinceMs: number;
  /** Absolute checkout roots; a transcript counts when its cwd is one of these or below. */
  repoRoots: string[];
  /** Loaded-but-unused threshold: assistant turns after the load. */
  shortTurns: number;
}

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Text of a string or of the text-bearing blocks in a content array. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const t = str(block.text);
    if (t && (block.type === "text" || block.type === "input_text" || block.type === "output_text")) parts.push(t);
  }
  return parts.join("\n");
}

export function inRepo(cwd: string, roots: string[]): boolean {
  return roots.some((root) => cwd === root || cwd.startsWith(`${root}/`));
}

export function inWindow(ts: string, sinceMs: number): boolean {
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= sinceMs;
}

/** Parsed JSONL records; torn lines (a transcript still being written) are skipped. */
export async function* readJsonl(file: string): AsyncGenerator<Json> {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (isRecord(parsed)) yield parsed;
  }
}

/** `*.jsonl` files under `dir` modified at or after `sinceMs`. */
export function recentJsonl(dir: string, sinceMs: number): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl") && fs.statSync(p).mtimeMs >= sinceMs) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/**
 * A skill or command name: what the report may print. Anything else (a typed
 * path, free text in a tag or tool input) is transcript content and is dropped.
 */
export const NAME_SHAPE = /^[A-Za-z][\w:-]{0,63}$/;

/** Commands wrapped in a human slash-command turn, e.g. `<command-name>/finish</command-name>`. */
export function commandNames(text: string): string[] {
  return [...text.matchAll(/<command-name>\/?([^<]*)<\/command-name>/g)].map((m) => m[1] ?? "").filter((n) => NAME_SHAPE.test(n));
}

/** Drops harness-injected tags so only the prose of a briefing is scanned. */
function stripInjected(text: string): string {
  return text.replaceAll(/<(command-[a-z]+|system-reminder|local-command-[a-z]+)>[\S\s]*?<\/\1>/g, " ");
}

/**
 * Count the skills a briefing names. A sigil (`/finish`, `$finish`) in an
 * agent-written briefing is a repo-rule violation, since some harnesses treat
 * it as an invocation; the human's own first message is exempt.
 */
export function recordBriefing(ctx: ScanContext, ev: { text: string; source: Source; session: string; ts: string; via: BriefingVia }): void {
  const mentions = findMentions(stripInjected(ev.text), ctx.mentionNames);
  let sigil = false;
  for (const [skill, forms] of mentions) {
    ctx.stats.record({ source: ev.source, skill, kind: "briefing", session: ev.session, ts: ev.ts });
    const s = ctx.stats.skill(skill, ev.source);
    s.via[ev.via]++;
    for (const form of forms) s.forms[form]++;
    if (forms.has("slash") || forms.has("dollar")) sigil = true;
  }
  if (sigil && ev.via !== "human-first") ctx.stats.sigilBriefings[ev.source].add(ev.session);
}
