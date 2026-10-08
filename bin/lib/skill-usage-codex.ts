/**
 * Codex rollout scanner for `bin/skill-usage.ts`.
 *
 * Marker shapes (verified against rollouts, 2026-10):
 * - the first line is `session_meta` with `cwd`, `originator` (`codex-tui`,
 *   `codex_exec`, `codex_sdk_ts`), `thread_source` (`user` / `subagent`), and,
 *   for subagents, `parent_thread_id` plus `subagent_history_start_ordinal`
 *   (lines below it replay the parent's history and are skipped);
 * - a human invocation is `$<skill>` in a typed user message; Codex then
 *   injects a user message starting `<skill>\n<name><skill></name>` (the load);
 * - an agent invocation is a tool call (`exec_command` arguments or a `exec`
 *   script) whose text names `skills/<skill>/SKILL.md`;
 * - `spawn_agent` arguments carry the subagent briefing in `message`;
 * - harness injections (`# AGENTS.md`, `<environment_context>`) are user
 *   messages too and are skipped.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { canonical } from "./skill-usage-catalog.ts";
import { FAILURE_PATTERNS, HUMAN_PATTERNS, matchingLabels } from "./skill-usage-patterns.ts";
import { inWindow, recordBriefing, textOf, type ScanContext } from "./skill-usage-scan.ts";
import { LoadTracker } from "./skill-usage-stats.ts";
import { codexDayDirs, inRepo, isRecord, readJsonl, str, type Json } from "./transcripts.ts";

const BRIEFING_START = /^(Workstream:|Continue workstream)/;
const FAILED_OUTPUT = /process exited with code [1-9]|script failed|exit code:? [1-9]|"exit_code":\s*[1-9]/i;

interface Rollout {
  session: string;
  kind: "interactive" | "exec" | "sdk" | "subagent";
  historyStart: number;
  tracker: LoadTracker;
  sawFirstUser: boolean;
  counted: boolean;
}

function metaOf(p: Json, ctx: ScanContext): Rollout | null {
  if (!inRepo(str(p.cwd), ctx.repoRoots)) return null;
  const source = isRecord(p.source) && isRecord(p.source.subagent) && isRecord(p.source.subagent.thread_spawn) ? p.source.subagent.thread_spawn : {};
  const parent = str(p.parent_thread_id) || str(source.parent_thread_id);
  const originator = str(p.originator);
  let kind: Rollout["kind"] = "sdk";
  if (p.thread_source === "subagent" || parent) kind = "subagent";
  else if (originator === "codex-tui") kind = "interactive";
  else if (originator === "codex_exec") kind = "exec";
  const start = p.subagent_history_start_ordinal;
  return {
    session: parent || str(p.id) || str(p.session_id), kind, historyStart: typeof start === "number" ? start : -1,
    tracker: new LoadTracker(), sawFirstUser: false, counted: false,
  };
}

function handleUserMessage(ctx: ScanContext, ev: { r: Rollout; text: string; id: string; ts: string }): void {
  const { r, text, ts } = ev;
  const skillLoad = /^<skill>\s*<name>([^<]+)<\/name>/.exec(text);
  if (skillLoad?.[1]) {
    if (!ctx.stats.firstSighting(`cload:${ev.id}`)) return;
    const skill = canonical(ctx.catalog, skillLoad[1]);
    ctx.stats.record({ source: "codex", skill, kind: "load", session: r.session, ts });
    r.tracker.load(skill, "codex");
    return;
  }
  if (text.startsWith("<") || text.startsWith("# AGENTS.md") || r.kind === "subagent") return;
  const first = !r.sawFirstUser;
  r.sawFirstUser = true;
  if (!ctx.stats.firstSighting(`cuser:${ev.id}`)) return;
  if (r.kind !== "interactive") {
    if (first) recordBriefing(ctx, { text, source: "codex", session: r.session, ts, via: "launch" });
    return;
  }
  for (const m of text.matchAll(/(?:^|\s)\$([a-z][\w:-]*)/gi)) {
    const name = canonical(ctx.catalog, m[1] ?? "");
    if (ctx.mentionNames.has(name)) ctx.stats.record({ source: "codex", skill: name, kind: "human", session: r.session, ts });
  }
  const launched = first && BRIEFING_START.test(text);
  if (first) recordBriefing(ctx, { text: text.replaceAll(/(?:^|\s)\$[a-z][\w:-]*/gi, " "), source: "codex", session: r.session, ts, via: launched ? "launch" : "human-first" });
  if (launched) return;
  if (text.length > 1500) return;
  ctx.stats.humanTurns.codex.add(r.session);
  ctx.stats.labelled({ table: "human", labels: matchingLabels(text, HUMAN_PATTERNS), source: "codex", session: r.session });
}

function handleToolCall(ctx: ScanContext, ev: { r: Rollout; p: Json; ts: string }): void {
  const { r, p, ts } = ev;
  r.tracker.assistantTurn();
  const callId = str(p.call_id) || str(p.id);
  if (!ctx.stats.firstSighting(`ccall:${callId}`)) return;
  const body = str(p.arguments) || str(p.input);
  const names = new Set([...body.matchAll(/skills\/([\w-]+)\/SKILL\.md/g)].map((m) => canonical(ctx.catalog, m[1] ?? "")));
  for (const skill of names) ctx.stats.record({ source: "codex", skill, kind: "agent", session: r.session, ts, sessionKind: r.kind });
  if (p.name !== "spawn_agent") return;
  let args: unknown;
  try {
    args = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
  if (isRecord(args) && str(args.message)) recordBriefing(ctx, { text: str(args.message), source: "codex", session: r.session, ts, via: "agent-prompt" });
}

function handleOutput(ctx: ScanContext, ev: { r: Rollout; p: Json }): void {
  const out = typeof ev.p.output === "string" ? ev.p.output : textOf(ev.p.output);
  if (!FAILED_OUTPUT.test(out) || !ctx.stats.firstSighting(`cout:${str(ev.p.call_id)}`)) return;
  ctx.stats.failedResults.codex.add(ev.r.session);
  ctx.stats.labelled({ table: "failure", labels: matchingLabels(out.slice(0, 4000), FAILURE_PATTERNS), source: "codex", session: ev.r.session });
}

async function scanRollout(ctx: ScanContext, file: string): Promise<void> {
  let r: Rollout | null = null;
  for await (const o of readJsonl(file)) {
    const p = isRecord(o.payload) ? o.payload : {};
    if (!r) {
      r = o.type === "session_meta" ? metaOf(p, ctx) : null;
      if (!r) {
        ctx.stats.tally.codex.skippedFiles++;
        return;
      }
      continue;
    }
    const ts = str(o.timestamp);
    const ordinal = typeof o.ordinal === "number" ? o.ordinal : Infinity;
    if (o.type !== "response_item" || ordinal < r.historyStart || !inWindow(ts, ctx.sinceMs)) continue;
    if (!r.counted) {
      r.counted = true;
      if (r.kind === "subagent") ctx.stats.tally.codex.subagents++;
      else ctx.stats.session({ source: "codex", session: r.session, kind: r.kind, ts });
    }
    const id = `${r.session}:${str(p.id) || ordinal}`;
    if (p.type === "message" && p.role === "user") handleUserMessage(ctx, { r, text: textOf(p.content), id, ts });
    else if (p.type === "message" && p.role === "assistant") r.tracker.assistantTurn();
    else if (p.type === "function_call" || p.type === "custom_tool_call") handleToolCall(ctx, { r, p, ts });
    else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") handleOutput(ctx, { r, p });
  }
  r?.tracker.flush(ctx.stats, ctx.shortTurns);
}

/** Rollouts under `sessions/YYYY/MM/DD/` from the day before the window on. */
export async function scanCodex(ctx: ScanContext, sessionsRoot: string): Promise<void> {
  const cutoff = new Date(ctx.sinceMs - 864e5).toISOString().slice(0, 10);
  const days = codexDayDirs(sessionsRoot).filter((d) => d.date >= cutoff).map((d) => d.dir);
  for (const day of days) {
    for (const f of fs.readdirSync(day)) if (f.endsWith(".jsonl")) await scanRollout(ctx, path.join(day, f));
  }
}
