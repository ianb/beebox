/**
 * Claude Code transcript scanner for `bin/skill-usage.ts`.
 *
 * Marker shapes (verified against transcripts, 2026-10):
 * - human invocation: a non-meta `user` turn containing
 *   `<command-name>/<skill></command-name>`;
 * - agent invocation: an `assistant` `tool_use` block named `Skill` with
 *   `input.skill`;
 * - load: an `isMeta` `user` turn whose text starts
 *   `Base directory for this skill: <dir>`, injected after either invocation;
 * - attribution: `assistant` lines carry `attributionSkill` while a skill drives;
 * - human turns carry `origin.kind === "human"` (older lines have no origin);
 *   subagent transcripts live under `<session>/subagents/` and share the
 *   parent's `sessionId`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { canonical, categoryOf } from "./skill-usage-catalog.ts";
import { FAILURE_PATTERNS, HUMAN_PATTERNS, matchingLabels } from "./skill-usage-patterns.ts";
import {
  commandNames, inRepo, NAME_SHAPE, inWindow, isRecord, readJsonl, recentJsonl, recordBriefing, str, textOf,
  type Json, type ScanContext,
} from "./skill-usage-scan.ts";
import { LoadTracker } from "./skill-usage-stats.ts";

const LOAD_PREFIX = "Base directory for this skill:";
const BRIEFING_START = /^(Workstream:|Continue workstream)/;

interface FileState {
  file: string;
  isSub: boolean;
  /** interactive, sdk, or subagent; set from the first in-window line. */
  kind: string;
  tracker: LoadTracker;
  /** Main transcripts: the first non-meta user turn is the briefing. */
  sawFirstUser: boolean;
  assistantIds: Set<string>;
  counted: boolean;
}

function isSkillName(ctx: ScanContext, name: string): boolean {
  const c = canonical(ctx.catalog, name);
  return name.includes(":") || categoryOf(ctx.catalog, c) !== "other";
}

function handleAssistant(ctx: ScanContext, ev: { o: Json; st: FileState; session: string; ts: string }): void {
  const msg = isRecord(ev.o.message) ? ev.o.message : {};
  const id = str(msg.id) || str(ev.o.uuid);
  if (!ev.st.assistantIds.has(id)) {
    ev.st.assistantIds.add(id);
    ev.st.tracker.assistantTurn();
    const attributed = str(ev.o.attributionSkill);
    if (attributed && ctx.stats.firstSighting(`attr:${id}`)) ctx.stats.skill(canonical(ctx.catalog, attributed), "claude").attributedTurns++;
  }
  if (!Array.isArray(msg.content)) return;
  for (const block of msg.content) {
    if (!isRecord(block) || block.type !== "tool_use" || !isRecord(block.input)) continue;
    if (!ctx.stats.firstSighting(`tool:${str(block.id)}`)) continue;
    if (block.name === "Skill" && NAME_SHAPE.test(str(block.input.skill))) {
      ctx.stats.record({ source: "claude", skill: canonical(ctx.catalog, str(block.input.skill)), kind: "agent", session: ev.session, ts: ev.ts, sessionKind: ev.st.kind });
    } else if ((block.name === "Agent" || block.name === "Task") && str(block.input.prompt)) {
      recordBriefing(ctx, { text: str(block.input.prompt), source: "claude", session: ev.session, ts: ev.ts, via: "agent-prompt" });
    }
  }
}

function handleToolErrors(ctx: ScanContext, ev: { content: unknown[]; session: string }): void {
  for (const block of ev.content) {
    if (!isRecord(block) || block.type !== "tool_result" || block.is_error !== true) continue;
    if (!ctx.stats.firstSighting(`err:${str(block.tool_use_id)}`)) continue;
    ctx.stats.failedResults.claude.add(ev.session);
    const text = textOf(block.content).slice(0, 4000);
    ctx.stats.labelled({ table: "failure", labels: matchingLabels(text, FAILURE_PATTERNS), source: "claude", session: ev.session });
  }
}

function isHumanAuthored(o: Json): boolean {
  const origin = isRecord(o.origin) ? str(o.origin.kind) : "";
  if (origin && origin !== "human") return false;
  const source = str(o.promptSource);
  return source !== "sdk" && source !== "system" && !str(o.entrypoint).startsWith("sdk");
}

function handleUser(ctx: ScanContext, ev: { o: Json; st: FileState; session: string; ts: string }): void {
  const { o, st, session, ts } = ev;
  const content = isRecord(o.message) ? o.message.content : undefined;
  if (Array.isArray(content)) handleToolErrors(ctx, { content, session });
  if (o.toolUseResult !== undefined) return;
  const text = textOf(content);
  if (o.isMeta === true) {
    if (!text.startsWith(LOAD_PREFIX) || !ctx.stats.firstSighting(`load:${str(o.uuid)}`)) return;
    const dir = (text.slice(LOAD_PREFIX.length).split("\n")[0] ?? "").trim();
    const skill = canonical(ctx.catalog, path.basename(dir));
    ctx.stats.record({ source: "claude", skill, kind: "load", session, ts });
    st.tracker.load(skill, "claude");
    return;
  }
  if (st.isSub || !text) return;
  const first = !st.sawFirstUser;
  st.sawFirstUser = true;
  if (!ctx.stats.firstSighting(`user:${str(o.uuid)}`)) return;
  for (const name of commandNames(text)) {
    if (isSkillName(ctx, name)) ctx.stats.record({ source: "claude", skill: canonical(ctx.catalog, name), kind: "human", session, ts });
    else ctx.stats.otherCommand(name, session);
  }
  const launched = first && (BRIEFING_START.test(text) || !isHumanAuthored(o));
  if (first) recordBriefing(ctx, { text, source: "claude", session, ts, via: launched ? "launch" : "human-first" });
  const human = isHumanAuthored(o) && !text.trimStart().startsWith("<") && text.length <= 1500 && !launched;
  if (!human) return;
  ctx.stats.humanTurns.claude.add(session);
  ctx.stats.labelled({ table: "human", labels: matchingLabels(text, HUMAN_PATTERNS), source: "claude", session });
}

async function scanFile(ctx: ScanContext, file: string): Promise<void> {
  const st: FileState = {
    file, isSub: file.includes(`${path.sep}subagents${path.sep}`), kind: "", tracker: new LoadTracker(),
    sawFirstUser: false, assistantIds: new Set(), counted: false,
  };
  let checkedCwd = false;
  for await (const o of readJsonl(file)) {
    const cwd = str(o.cwd);
    if (!checkedCwd && cwd) {
      checkedCwd = true;
      if (!inRepo(cwd, ctx.repoRoots)) {
        ctx.stats.tally.claude.skippedFiles++;
        return;
      }
    }
    const ts = str(o.timestamp);
    const session = str(o.sessionId);
    if (!checkedCwd || !session || !inWindow(ts, ctx.sinceMs)) continue;
    if (!st.counted) {
      st.counted = true;
      st.kind = str(o.entrypoint).startsWith("sdk") ? "sdk" : "interactive";
      if (st.isSub) {
        st.kind = "subagent";
        ctx.stats.tally.claude.subagents++;
      } else ctx.stats.session({ source: "claude", session, kind: st.kind, ts });
    }
    if (o.type === "assistant") handleAssistant(ctx, { o, st, session, ts });
    else if (o.type === "user") handleUser(ctx, { o, st, session, ts });
  }
  st.tracker.flush(ctx.stats, ctx.shortTurns);
}

/** Every project directory once (renamed checkouts are symlinked aliases). */
function projectDirs(projectsRoot: string): string[] {
  const seen = new Set<string>();
  for (const entry of fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : []) {
    let real: string;
    try {
      real = fs.realpathSync(path.join(projectsRoot, entry));
    } catch (error) {
      if (error instanceof Error) continue;
      throw error;
    }
    if (fs.statSync(real).isDirectory()) seen.add(real);
  }
  return [...seen];
}

export async function scanClaude(ctx: ScanContext, projectsRoot: string): Promise<void> {
  for (const dir of projectDirs(projectsRoot)) {
    for (const file of recentJsonl(dir, ctx.sinceMs)) await scanFile(ctx, file);
  }
}
