/**
 * The accumulator `bin/skill-usage.ts` fills while scanning transcripts. It
 * holds names, labels, counts, session ids, and timestamps only; no transcript
 * text is ever stored.
 */

import type { MentionForm } from "./skill-usage-catalog.ts";

export type Source = "claude" | "codex";
export const SOURCES: Source[] = ["claude", "codex"];
export type EventKind = "human" | "agent" | "load" | "briefing";
export const EVENT_KINDS: EventKind[] = ["human", "agent", "load", "briefing"];
/** Who wrote a briefing: a launcher (worktree/headless/exec), the human's first message, or an Agent/spawn_agent prompt. */
export type BriefingVia = "launch" | "human-first" | "agent-prompt";

export class Counter {
  events = 0;
  readonly sessions = new Set<string>();
  add(session: string): void {
    this.events++;
    this.sessions.add(session);
  }
}

export class SkillStats {
  readonly kinds: Record<EventKind, Counter> = { human: new Counter(), agent: new Counter(), load: new Counter(), briefing: new Counter() };
  readonly forms: Record<MentionForm, number> = { bare: 0, slash: 0, dollar: 0, path: 0 };
  readonly via: Record<BriefingVia, number> = { launch: 0, "human-first": 0, "agent-prompt": 0 };
  /** Transcripts where the skill loaded and the session ended ≤ N assistant turns later. */
  shortAfterLoad = 0;
  /** Transcripts where the skill body loaded more than once. */
  repeatLoad = 0;
  /** Distinct assistant messages Claude Code attributed to the skill. */
  attributedTurns = 0;
  /** Agent invocations by the kind of session that made them (interactive, sdk, exec, subagent). */
  readonly agentByKind = new Map<string, Counter>();
  lastUsed = "";
}

export interface SessionTally {
  /** Top-level sessions (Claude main transcripts; Codex non-subagent rollouts), by kind. */
  sessions: Map<string, Set<string>>;
  /** Subagent transcripts / rollouts. */
  subagents: number;
  /** Transcript files skipped because their cwd is outside the repo. */
  skippedFiles: number;
  firstEvent: string;
  lastEvent: string;
}

function newTally(): SessionTally {
  return { sessions: new Map(), subagents: 0, skippedFiles: 0, firstEvent: "", lastEvent: "" };
}

export class UsageStats {
  readonly skills = new Map<string, Record<Source, SkillStats>>();
  readonly tally: Record<Source, SessionTally> = { claude: newTally(), codex: newTally() };
  /** `YYYY-MM` → invocations (human + agent) per source. */
  readonly monthly = new Map<string, Record<Source, number>>();
  readonly humanPatterns = new Map<string, Record<Source, Counter>>();
  readonly failures = new Map<string, Record<Source, Counter>>();
  /** Slash commands typed by the human that are not skills (`/compact`, `/model`). */
  readonly otherCommands = new Map<string, Counter>();
  readonly humanTurns: Record<Source, Counter> = { claude: new Counter(), codex: new Counter() };
  readonly failedResults: Record<Source, Counter> = { claude: new Counter(), codex: new Counter() };
  /** Sessions with a sigil in an agent-written briefing. */
  readonly sigilBriefings: Record<Source, Counter> = { claude: new Counter(), codex: new Counter() };
  /** `source:session` → distinct skills the agent invoked there; a bulk read of many skills is not a focused use. */
  readonly agentSkillsBySession = new Map<string, Set<string>>();
  private readonly seen = new Set<string>();

  /** True the first time an id is seen; resumed and forked transcripts replay lines. */
  firstSighting(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }

  skill(name: string, source: Source): SkillStats {
    let entry = this.skills.get(name);
    if (!entry) {
      entry = { claude: new SkillStats(), codex: new SkillStats() };
      this.skills.set(name, entry);
    }
    return entry[source];
  }

  record(ev: { source: Source; skill: string; kind: EventKind; session: string; ts: string; sessionKind?: string }): void {
    const s = this.skill(ev.skill, ev.source);
    s.kinds[ev.kind].add(ev.session);
    if (ev.kind === "agent") {
      const key = `${ev.source}:${ev.session}`;
      const set = this.agentSkillsBySession.get(key) ?? new Set<string>();
      set.add(ev.skill);
      this.agentSkillsBySession.set(key, set);
    }
    if (ev.kind === "agent" && ev.sessionKind) {
      const c = s.agentByKind.get(ev.sessionKind) ?? new Counter();
      c.add(ev.session);
      s.agentByKind.set(ev.sessionKind, c);
    }
    if (ev.kind === "briefing") return;
    if (ev.ts > s.lastUsed) s.lastUsed = ev.ts;
    if (ev.kind === "load") return;
    const month = ev.ts.slice(0, 7);
    const row = this.monthly.get(month) ?? { claude: 0, codex: 0 };
    row[ev.source]++;
    this.monthly.set(month, row);
  }

  session(ev: { source: Source; session: string; kind: string; ts: string }): void {
    const t = this.tally[ev.source];
    const set = t.sessions.get(ev.kind) ?? new Set<string>();
    set.add(ev.session);
    t.sessions.set(ev.kind, set);
    if (!t.firstEvent || ev.ts < t.firstEvent) t.firstEvent = ev.ts;
    if (ev.ts > t.lastEvent) t.lastEvent = ev.ts;
  }

  labelled(ev: { table: "human" | "failure"; labels: string[]; source: Source; session: string }): void {
    const table = ev.table === "human" ? this.humanPatterns : this.failures;
    for (const label of ev.labels) {
      const row = table.get(label) ?? { claude: new Counter(), codex: new Counter() };
      row[ev.source].add(ev.session);
      table.set(label, row);
    }
  }

  otherCommand(name: string, session: string): void {
    const c = this.otherCommands.get(name) ?? new Counter();
    c.add(session);
    this.otherCommands.set(name, c);
  }
}

/**
 * Per-transcript load tracking for the loaded-but-unused proxy: how many
 * assistant turns followed the first load, and how often the body loaded.
 */
export class LoadTracker {
  private assistantTurns = 0;
  private readonly loads = new Map<string, { count: number; turnsAtFirst: number; source: Source }>();

  assistantTurn(): void {
    this.assistantTurns++;
  }

  load(skill: string, source: Source): void {
    const prior = this.loads.get(skill);
    if (prior) prior.count++;
    else this.loads.set(skill, { count: 1, turnsAtFirst: this.assistantTurns, source });
  }

  flush(stats: UsageStats, shortTurns: number): void {
    for (const [skill, l] of this.loads) {
      const s = stats.skill(skill, l.source);
      if (this.assistantTurns - l.turnsAtFirst <= shortTurns) s.shortAfterLoad++;
      if (l.count > 1) s.repeatLoad++;
    }
  }
}
