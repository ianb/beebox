/**
 * Renders `UsageStats` as markdown tables (default) or a JSON summary for
 * `bin/skill-usage.ts`. Only names, labels, dates, and counts are emitted.
 */

import { categoryOf, type MentionForm, type SkillCatalog } from "./skill-usage-catalog.ts";
import {
  EVENT_KINDS, SOURCES, type BriefingVia, type Counter, type EventKind, type SkillStats, type Source, type UsageStats,
} from "./skill-usage-stats.ts";

type Row = (string | number)[];

/** A session that invoked more distinct skills than this was reading skills in bulk. */
const FOCUSED_MAX = 3;

function table(header: string[], rows: Row[]): string {
  const line = (cells: Row): string => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function cell(c: Counter): string {
  return c.events ? `${c.events}/${c.sessions.size}` : "–";
}

/** Distinct sessions with any invocation or load of the skill, across both sources. */
function usedSessions(entry: Record<Source, SkillStats>): Set<string> {
  const all = new Set<string>();
  for (const source of SOURCES) {
    for (const kind of ["human", "agent", "load"] satisfies EventKind[]) {
      for (const s of entry[source].kinds[kind].sessions) all.add(`${source}:${s}`);
    }
  }
  return all;
}

function orderedSkills(stats: UsageStats, catalog: SkillCatalog): string[] {
  const names = new Set([...catalog.repo, ...catalog.retired, ...catalog.user, ...stats.skills.keys()]);
  const rank = { repo: 0, retired: 1, user: 2, harness: 3, other: 4 };
  return [...names].toSorted((a, b) => rank[categoryOf(catalog, a)] - rank[categoryOf(catalog, b)] || a.localeCompare(b));
}

function entryOf(stats: UsageStats, name: string): Record<Source, SkillStats> {
  return { claude: stats.skill(name, "claude"), codex: stats.skill(name, "codex") };
}

function lastUsed(entry: Record<Source, SkillStats>): string {
  return [entry.claude.lastUsed, entry.codex.lastUsed].toSorted().at(-1)?.slice(0, 10) || "–";
}

function labelRows(m: Map<string, Record<Source, Counter>>): Row[] {
  return [...m]
    .map(([label, r]) => ({ label, r, total: r.claude.sessions.size + r.codex.sessions.size }))
    .toSorted((a, b) => b.total - a.total)
    .map(({ label, r }) => [label, r.claude.sessions.size, r.claude.events, r.codex.sessions.size, r.codex.events]);
}

export function renderMarkdown(stats: UsageStats, opts: { catalog: SkillCatalog; sinceDays: number; shortTurns: number }): string {
  const { catalog } = opts;
  const names = orderedSkills(stats, catalog);
  const out: string[] = [`# Skill usage, last ${opts.sinceDays} days`, "", "## Sessions scanned", ""];
  out.push(table(["source", "top-level sessions by kind", "subagent transcripts", "skipped (cwd outside repo)", "first event", "last event"],
    SOURCES.map((s) => {
      const t = stats.tally[s];
      const kinds = [...t.sessions].map(([k, v]) => `${k} ${v.size}`).join(", ");
      return [s, kinds || "–", t.subagents, t.skippedFiles, t.firstEvent.slice(0, 10) || "–", t.lastEvent.slice(0, 10) || "–"];
    })));
  out.push("", "## Per-skill events (events/sessions)", "");
  const kindCols = SOURCES.flatMap((s) => EVENT_KINDS.map((k) => `${s} ${k}`));
  out.push(table(["skill", "cat", ...kindCols, "last used"], names.map((n) => {
    const e = entryOf(stats, n);
    return [n, categoryOf(catalog, n), ...SOURCES.flatMap((s) => EVENT_KINDS.map((k) => cell(e[s].kinds[k]))), lastUsed(e)];
  })));
  const ranked = names.map((n) => ({ n, sessions: usedSessions(entryOf(stats, n)).size })).toSorted((a, b) => b.sessions - a.sessions);
  const kinds = SOURCES.flatMap((s) => [...new Set(names.flatMap((n) => [...stats.skill(n, s).agentByKind.keys()]))].toSorted().map((k) => ({ s, k })));
  out.push("", "## Agent invocations by session kind (events/sessions)", "");
  const focused = (n: string, s: Source): number =>
    [...stats.skill(n, s).kinds.agent.sessions].filter((id) => (stats.agentSkillsBySession.get(`${s}:${id}`)?.size ?? 0) <= FOCUSED_MAX).length;
  out.push(`Focused = sessions where the agent invoked at most ${FOCUSED_MAX} distinct skills (excludes bulk skill reads and skill-review sweeps).`, "");
  out.push(table(["skill", ...kinds.map(({ s, k }) => `${s} ${k}`), "claude focused", "codex focused"], names.filter((n) => SOURCES.some((s) => stats.skill(n, s).kinds.agent.events > 0))
    .map((n) => [n, ...kinds.map(({ s, k }) => { const c = stats.skill(n, s).agentByKind.get(k); return c ? cell(c) : "–"; }), focused(n, "claude"), focused(n, "codex")])));
  out.push("", "## Top skills by sessions (human + agent + load, both sources)", "");
  out.push(table(["skill", "sessions"], ranked.filter((r) => r.sessions > 0).slice(0, 15).map((r) => [r.n, r.sessions])));
  const unused = (pred: (n: string) => boolean): string => names.filter((n) => ["repo", "retired", "user"].includes(categoryOf(catalog, n)) && pred(n)).join(", ") || "none";
  out.push("", "## Zero-event skills", "");
  out.push(`- No invocation or load: ${unused((n) => usedSessions(entryOf(stats, n)).size === 0)}`);
  out.push(`- Not even a briefing mention: ${unused((n) => SOURCES.every((s) => EVENT_KINDS.every((k) => stats.skill(n, s).kinds[k].events === 0)))}`);
  out.push("", `## Loaded-but-unused proxy (session ended ≤ ${opts.shortTurns} assistant turns after load, or body loaded twice)`, "");
  out.push(table(["skill", "claude loads", "claude short", "claude repeat", "claude attributed turns", "codex loads", "codex short", "codex repeat"],
    names.filter((n) => SOURCES.some((s) => stats.skill(n, s).kinds.load.events > 0)).map((n) => {
      const c = stats.skill(n, "claude");
      const x = stats.skill(n, "codex");
      return [n, c.kinds.load.events, c.shortAfterLoad, c.repeatLoad, c.attributedTurns, x.kinds.load.events, x.shortAfterLoad, x.repeatLoad];
    })));
  const forms: MentionForm[] = ["bare", "slash", "dollar", "path"];
  out.push("", "## Briefing mention forms (briefings mentioning the skill in each form, both sources)", "");
  const vias: BriefingVia[] = ["launch", "human-first", "agent-prompt"];
  const both = (n: string, pick: (s: SkillStats) => number): number => pick(stats.skill(n, "claude")) + pick(stats.skill(n, "codex"));
  out.push(table(["skill", ...forms, ...vias], names.filter((n) => SOURCES.some((s) => stats.skill(n, s).kinds.briefing.events > 0))
    .map((n) => [n, ...forms.map((f) => both(n, (s) => s.forms[f])), ...vias.map((v) => both(n, (s) => s.via[v]))])));
  out.push("", `Sessions with a sigil (\`/name\` or \`$name\`) in an agent-written briefing (launch or agent prompt): claude ${stats.sigilBriefings.claude.sessions.size}, codex ${stats.sigilBriefings.codex.sessions.size}.`);
  out.push("", "## Monthly invocations (human + agent)", "");
  out.push(table(["month", "claude", "codex"], [...stats.monthly].toSorted(([a], [b]) => a.localeCompare(b)).map(([m, r]) => [m, r.claude, r.codex])));
  out.push("", "## Non-skill slash commands typed (claude)", "");
  out.push(table(["command", "events", "sessions"], [...stats.otherCommands].toSorted((a, b) => b[1].events - a[1].events).slice(0, 15).map(([n, c]) => [`/${n}`, c.events, c.sessions.size])));
  out.push("", `## Recurring human instructions (human turns: claude ${cell(stats.humanTurns.claude)}, codex ${cell(stats.humanTurns.codex)})`, "");
  out.push(table(["pattern", "claude sessions", "claude turns", "codex sessions", "codex turns"], labelRows(stats.humanPatterns)));
  out.push("", `## Recurring tool failures (failed results: claude ${cell(stats.failedResults.claude)}, codex ${cell(stats.failedResults.codex)})`, "");
  out.push(table(["failure", "claude sessions", "claude events", "codex sessions", "codex events"], labelRows(stats.failures)));
  return `${out.join("\n")}\n`;
}

function counterJson(c: Counter): { events: number; sessions: number } {
  return { events: c.events, sessions: c.sessions.size };
}

export function renderJson(stats: UsageStats, opts: { catalog: SkillCatalog; sinceDays: number }): unknown {
  const skills = Object.fromEntries(orderedSkills(stats, opts.catalog).map((n) => {
    const e = entryOf(stats, n);
    const perSource = Object.fromEntries(SOURCES.map((s) => [s, {
      ...Object.fromEntries(EVENT_KINDS.map((k) => [k, counterJson(e[s].kinds[k])])),
      forms: e[s].forms, via: e[s].via, agentByKind: Object.fromEntries([...e[s].agentByKind].map(([k, c]) => [k, counterJson(c)])),
      shortAfterLoad: e[s].shortAfterLoad, repeatLoad: e[s].repeatLoad,
      attributedTurns: e[s].attributedTurns, lastUsed: e[s].lastUsed || null,
    }]));
    return [n, { category: categoryOf(opts.catalog, n), sessions: usedSessions(e).size, ...perSource }];
  }));
  const labels = (m: Map<string, Record<Source, Counter>>): unknown =>
    Object.fromEntries([...m].map(([l, r]) => [l, { claude: counterJson(r.claude), codex: counterJson(r.codex) }]));
  return {
    sinceDays: opts.sinceDays,
    sessions: Object.fromEntries(SOURCES.map((s) => {
      const t = stats.tally[s];
      return [s, { ...Object.fromEntries([...t.sessions].map(([k, v]) => [k, v.size])), subagents: t.subagents, skippedFiles: t.skippedFiles, firstEvent: t.firstEvent, lastEvent: t.lastEvent }];
    })),
    skills,
    monthly: Object.fromEntries(stats.monthly),
    otherCommands: Object.fromEntries([...stats.otherCommands].map(([n, c]) => [n, counterJson(c)])),
    humanPatterns: labels(stats.humanPatterns),
    failures: labels(stats.failures),
    aliases: Object.fromEntries(opts.catalog.aliases),
  };
}
