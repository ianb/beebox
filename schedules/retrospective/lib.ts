/**
 * The retrospective's pure parts: the window, the stored run record and watch
 * list, which issues count as escaped bugs and which paths count as
 * prevention, whether there is anything to hand off, and the packet's layout.
 *
 * run.ts owns every read and write. The packet states evidence only; what an
 * entry or a pattern means is the session's judgment (prompt.md).
 */

import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The skill-usage window never drops below the cadence. */
export const MIN_WINDOW_DAYS = 3;
/**
 * With no stored run, the issue and skill-usage window reaches this far back.
 * CODING_FEEDBACK entries have no such limit on a first run: every entry is new.
 */
export const FIRST_RUN_DAYS = 14;

const isoSchema = z.iso.datetime();

const issueMetaSchema = z.looseObject({
  title: z.string().optional(),
  "discovered-in": z.string().optional(),
  labels: z.array(z.string()).optional(),
});

/** What run.ts stores after each real run (`last-run.json`). */
export const lastRunSchema = z.object({
  ranAt: isoSchema,
  /** Timestamp of the newest entry any run has consumed; null before the first. */
  watermark: isoSchema.nullable(),
  entries: z.number().int().nonnegative(),
  packet: z.string().nullable(),
});
export type LastRun = z.infer<typeof lastRunSchema>;

/** The watch list the session writes (`watch-list.json`). */
export const watchListSchema = z.object({
  updatedAt: isoSchema,
  items: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    summary: z.string().min(1),
    firstSeen: isoSchema,
    lastSeen: isoSchema,
    seen: z.number().int().positive(),
    evidence: z.array(z.string()),
  })),
});
export type WatchList = z.infer<typeof watchListSchema>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

/** Parse a stored JSON file against a schema; never throws. */
export function parseStored<T>(text: string, schema: z.ZodType<T>): Parsed<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, problem: `not JSON: ${error.message}` };
    throw error;
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, problem: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

/** From the last run to now, so a missed run widens the window instead of skipping it. */
export function windowStart(input: { lastRun: LastRun | null; now: Date }): string {
  if (input.lastRun !== null) return input.lastRun.ranAt;
  return new Date(input.now.getTime() - FIRST_RUN_DAYS * DAY_MS).toISOString();
}

/** Whole days for `skill-usage --since`, never below {@link MIN_WINDOW_DAYS}. */
export function windowDays(input: { start: string; now: Date }): number {
  const days = Math.ceil((input.now.getTime() - Date.parse(input.start)) / DAY_MS);
  return Math.max(MIN_WINDOW_DAYS, days);
}

/** The newest timestamp among the consumed entries, or the old watermark. */
export function nextWatermark(previous: string | null, timestamps: readonly string[]): string | null {
  let newest = previous;
  for (const t of timestamps) if (newest === null || Date.parse(t) > Date.parse(newest)) newest = t;
  return newest;
}

/** The frontmatter fields the escaped-bug filter reads. */
export interface IssueFacts {
  /** Path under `issues/`, where it lives now. */
  rel: string;
  title: string;
  discoveredIn: string;
  labels: string[];
}

/**
 * An escaped bug: found on production (`discovered-in:` mentions prod) or
 * labelled `bug`. The `bugs/` category alone does not count; most of it is
 * found during development and would bury the escaped ones.
 */
export function isEscapedBug(issue: IssueFacts): boolean {
  return /\bprod/iu.test(issue.discoveredIn) || issue.labels.includes("bug");
}

/** A changed path that adds a test or a check: what "has prevention" means. */
export function isPreventionPath(file: string): boolean {
  return (
    /(^|\/)tests?\//u.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/u.test(file) ||
    file.endsWith(".doctest.md") ||
    /^schedules\/[^/]+\/check$/u.test(file) ||
    /^bin\/[^/]*-check\.ts$/u.test(file) ||
    file.startsWith("personal-vibe-check/rules/") ||
    file.startsWith("security/opengrep/")
  );
}

/** Read `title`, `discovered-in`, and `labels` from an issue's YAML frontmatter. */
export function issueFacts(rel: string, text: string): IssueFacts {
  const block = /^---\n([\s\S]*?)\n---/u.exec(text)?.[1];
  let raw: unknown = null;
  try {
    raw = block === undefined ? null : parseYaml(block);
  } catch (error) {
    // doc-check rejects malformed frontmatter on commit; an uncommitted one reads as empty.
    if (!(error instanceof Error)) throw error;
  }
  const meta = issueMetaSchema.safeParse(raw);
  const data = meta.success ? meta.data : {};
  return { rel, title: data.title ?? "(no title)", discoveredIn: data["discovered-in"] ?? "", labels: data.labels ?? [] };
}

export interface FeedbackEntry {
  path: string;
  timestamp: string;
  workstream: string;
  checkpoint: string;
  transcriptPath: string | null;
  body: string;
}

export interface EscapedBug extends IssueFacts {
  /** Commits on main that cite it (`Issue:` trailer) or move its file, as `<short sha> <subject>`. */
  citedBy: string[];
  hasPrevention: boolean;
}

export interface Counts {
  claude: { events: number; sessions: number };
  codex: { events: number; sessions: number };
}

export interface SkillRow {
  skill: string;
  sessions: number;
  human: number;
  agent: number;
  load: number;
  briefing: number;
  shortAfterLoad: number;
}

export interface Packet {
  runId: string;
  windowStart: string;
  windowEnd: string;
  skillUsageDays: number;
  watermark: string | null;
  entries: FeedbackEntry[];
  humanPatterns: Record<string, Counts>;
  failures: Record<string, Counts>;
  skills: SkillRow[];
  bugs: EscapedBug[];
  watchListPath: string;
  watchList: Parsed<WatchList> | null;
}

/** Work for a session: a new entry, or an escaped bug with nothing preventing a repeat. */
export function hasWork(packet: Pick<Packet, "entries" | "bugs">): boolean {
  return packet.entries.length > 0 || packet.bugs.some((bug) => !bug.hasPrevention);
}

function countsTable(rows: Record<string, Counts>): string[] {
  const entries = Object.entries(rows).toSorted(
    ([, a], [, b]) => b.claude.sessions + b.codex.sessions - (a.claude.sessions + a.codex.sessions),
  );
  if (entries.length === 0) return ["None.", ""];
  return [
    "| label | claude events/sessions | codex events/sessions |",
    "|---|---|---|",
    ...entries.map(([label, c]) =>
      `| ${label} | ${String(c.claude.events)}/${String(c.claude.sessions)} | ${String(c.codex.events)}/${String(c.codex.sessions)} |`),
    "",
  ];
}

/** The first three citing commits, then a count. */
function citations(citedBy: readonly string[]): string {
  const shown = citedBy.slice(0, 3).join("; ");
  return citedBy.length > 3 ? `${shown}; and ${String(citedBy.length - 3)} more` : shown;
}

function entrySection(entry: FeedbackEntry): string[] {
  return [
    `### ${entry.timestamp} · ${entry.workstream} · ${entry.checkpoint}`,
    "",
    `- entry: \`${entry.path}\``,
    `- transcript: ${entry.transcriptPath === null ? "none recorded" : `\`${entry.transcriptPath}\``}`,
    "",
    ...entry.body.trimEnd().split("\n").map((line) => `> ${line}`),
    "",
  ];
}

function watchSection(packet: Packet): string[] {
  const head = [`## Watch list (\`${packet.watchListPath}\`)`, ""];
  if (packet.watchList === null) return [...head, "No watch list yet: this is the first session to write one.", ""];
  if (!packet.watchList.ok) return [...head, `The stored watch list does not parse (${packet.watchList.problem}). Rewrite it.`, ""];
  const { items } = packet.watchList.value;
  if (items.length === 0) return [...head, "Empty.", ""];
  return [...head, ...items.map((i) => `- **${i.id}** (seen ${String(i.seen)}×, last ${i.lastSeen}): ${i.summary}`), ""];
}

/** The packet the session reads: evidence and provenance, no verdicts. */
export function formatPacket(packet: Packet): string {
  const lines = [
    `# Retrospective packet ${packet.runId}`,
    "",
    `Window: ${packet.windowStart} → ${packet.windowEnd}. Entries after watermark: ${packet.watermark ?? "(none: first run, all entries)"}.`,
    "",
    `## CODING_FEEDBACK entries (${String(packet.entries.length)})`,
    "",
    ...(packet.entries.length === 0 ? ["None new.", ""] : packet.entries.flatMap(entrySection)),
    ...watchSection(packet),
    `## Recurring human instructions, last ${String(packet.skillUsageDays)} days`,
    "",
    ...countsTable(packet.humanPatterns),
    `## Recurring tool failures, last ${String(packet.skillUsageDays)} days`,
    "",
    ...countsTable(packet.failures),
    `## Skill use, last ${String(packet.skillUsageDays)} days (both engines)`,
    "",
    "| skill | sessions | human | agent | load | briefing | ended within 3 turns of load |",
    "|---|---|---|---|---|---|---|",
    ...packet.skills.map((s) =>
      `| ${s.skill} | ${String(s.sessions)} | ${String(s.human)} | ${String(s.agent)} | ${String(s.load)} | ${String(s.briefing)} | ${String(s.shortAfterLoad)} |`),
    "",
    `## Escaped bugs filed in the window (${String(packet.bugs.length)})`,
    "",
    ...(packet.bugs.length === 0
      ? ["None."]
      : packet.bugs.map((b) =>
        `- \`issues/${b.rel}\` — ${b.title} — prevention: ${b.hasPrevention ? "yes" : "no"}` +
          `${b.citedBy.length === 0 ? " (no commit on main cites or moves it)" : ` (linked: ${citations(b.citedBy)})`}`)),
    "",
  ];
  return lines.join("\n");
}
