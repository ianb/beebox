/**
 * The retrospective: gather what sessions reported about their own friction
 * since the last run, and hand it to a session that turns repeated findings
 * into tracked-file changes.
 *
 * Sources: CODING_FEEDBACK entries newer than the stored watermark (every
 * workstream), `bin/skill-usage.ts` aggregates for the window (recurring
 * instructions, recurring failures, per-skill counts), escaped bugs filed in
 * the window with whether a linked commit added a test or a check, and the
 * watch list the previous session left.
 *
 * State in `$SCHEDULE_STATE_DIR`: `last-run.json` (window start and entry
 * watermark), `packets/<runId>.md` (what each session read), and
 * `watch-list.json` (written by the session, read here). The watermark moves
 * only after the packet is written and handed off, so a failed run re-reads
 * the same entries. Pure parts and the packet layout: ./lib.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { z } from "zod";
import { issueFiles, filterByTrailer } from "../../bin/commit-provenance.ts";
import { parseEntry } from "../../bin/lib/coding-feedback.ts";
import {
  formatPacket, hasWork, isEscapedBug, isPreventionPath, issueFacts, lastRunSchema, nextWatermark, parseStored,
  watchListSchema, windowDays, windowStart, type Counts, type EscapedBug, type FeedbackEntry, type LastRun, type Packet,
  type SkillRow,
} from "./lib.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function refuse(message: string): never {
  process.stderr.write(`retrospective: ${message}\n`);
  process.exit(2);
}

async function run(file: string, args: string[]): Promise<string> {
  const result = await execa(file, args, { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) refuse(`${path.basename(file)} ${args.join(" ")} exited ${String(result.exitCode)}: ${result.stderr}`);
  return result.stdout;
}

const git = (args: string[]): Promise<string> => run("git", args);

const listedSchema = z.array(z.object({ path: z.string(), timestamp: z.string(), workstream: z.string(), checkpoint: z.string() }));

async function newEntries(watermark: string | null): Promise<FeedbackEntry[]> {
  const args = ["list", "--all", "--json", ...(watermark === null ? [] : ["--since", watermark])];
  const listed = listedSchema.parse(JSON.parse(await run(path.join(REPO_ROOT, "bin", "coding-feedback"), args)));
  const entries: FeedbackEntry[] = [];
  for (const item of listed) {
    const parsed = parseEntry(await fs.readFile(item.path, "utf8"));
    // `list` already skipped unparseable entries; one that changed since is skipped the same way.
    if (!parsed.ok) continue;
    entries.push({ ...item, transcriptPath: parsed.meta.transcriptPath, body: parsed.body });
  }
  return entries;
}

const countsSchema = z.object({ events: z.number(), sessions: z.number() });
const sourceSchema = z.looseObject({
  human: countsSchema, agent: countsSchema, load: countsSchema, briefing: countsSchema, shortAfterLoad: z.number(),
});
const usageSchema = z.looseObject({
  skills: z.record(z.string(), z.looseObject({ sessions: z.number(), claude: sourceSchema, codex: sourceSchema })),
  humanPatterns: z.record(z.string(), z.object({ claude: countsSchema, codex: countsSchema })),
  failures: z.record(z.string(), z.object({ claude: countsSchema, codex: countsSchema })),
});

async function skillUsage(days: number): Promise<{ humanPatterns: Record<string, Counts>; failures: Record<string, Counts>; skills: SkillRow[] }> {
  const out = await run(process.execPath, ["--import", "tsx", path.join(REPO_ROOT, "bin", "skill-usage.ts"), "--since", String(days), "--json"]);
  const usage = usageSchema.parse(JSON.parse(out));
  const skills = Object.entries(usage.skills)
    .map(([skill, s]): SkillRow => ({
      skill,
      sessions: s.sessions,
      human: s.claude.human.events + s.codex.human.events,
      agent: s.claude.agent.events + s.codex.agent.events,
      load: s.claude.load.events + s.codex.load.events,
      briefing: s.claude.briefing.events + s.codex.briefing.events,
      shortAfterLoad: s.claude.shortAfterLoad + s.codex.shortAfterLoad,
    }))
    .filter((row) => row.sessions > 0);
  return { humanPatterns: usage.humanPatterns, failures: usage.failures, skills };
}

/** Files a commit changed; a merge is compared with its first parent. */
async function changedFiles(sha: string): Promise<string[]> {
  const parents = (await git(["rev-list", "--parents", "-n", "1", sha])).split(" ");
  const out = parents.length > 1 ? await git(["diff", "--name-only", `${sha}^1`, sha]) : await git(["show", "--name-only", "--format=", sha]);
  return out.split("\n");
}

/**
 * Commits on main that cite the issue (`Issue:` trailer) or touch its file
 * after filing (a fix that closes it with `git mv`), and whether any of them
 * added a test or check. A fix with neither link reads as "no prevention".
 */
async function prevention(name: string): Promise<{ citedBy: string[]; hasPrevention: boolean }> {
  const pattern = `^Issue: ${name.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&")}$`;
  const records = await git(["log", "main", "--extended-regexp", `--grep=${pattern}`, "--format=%H %s%x00%(trailers:key=Issue,valueonly,unfold,separator=%x1f)"]);
  const touching = await git(["log", "main", "--diff-filter=MR", "--format=%H %s", "--", `:(glob)issues/**/${name}.md`]);
  const lines = [...new Set([...filterByTrailer(records, name), ...touching.split("\n").filter((l) => l !== "")])];
  const citedBy: string[] = [];
  let hasPrevention = false;
  for (const line of lines) {
    const [sha = "", ...subject] = line.split(" ");
    citedBy.push(`${sha.slice(0, 10)} ${subject.join(" ")}`);
    if ((await changedFiles(sha)).some(isPreventionPath)) hasPrevention = true;
  }
  return { citedBy, hasPrevention };
}

async function escapedBugs(start: string): Promise<EscapedBug[]> {
  const added = await git(["log", "main", `--since=${start}`, "--diff-filter=A", "--name-only", "--format=", "--", "issues/"]);
  const names = [...new Set(added.split("\n").filter((l) => l.endsWith(".md")).map((l) => path.basename(l, ".md")))];
  const current = issueFiles(path.join(REPO_ROOT, "issues"));
  const bugs: EscapedBug[] = [];
  for (const name of names) {
    const rel = current.get(name);
    if (rel === undefined) continue;
    const facts = issueFacts(rel, await fs.readFile(path.join(REPO_ROOT, "issues", rel), "utf8"));
    if (isEscapedBug(facts)) bugs.push({ ...facts, ...(await prevention(name)) });
  }
  return bugs;
}

async function readOptional(file: string): Promise<string | null> {
  return fs.readFile(file, "utf8").catch((e: unknown) => {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  });
}

const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined || stateDir === "") refuse("SCHEDULE_STATE_DIR is not set");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const runId = process.env["SCHEDULE_RUN_ID"] ?? "unknown-run";
const lastRunFile = path.join(stateDir, "last-run.json");
const watchListPath = path.join(stateDir, "watch-list.json");

const lastRunText = await readOptional(lastRunFile);
let lastRun: LastRun | null = null;
if (lastRunText !== null) {
  const parsed = parseStored(lastRunText, lastRunSchema);
  if (!parsed.ok) refuse(`${lastRunFile} does not parse (${parsed.problem}); fix or delete it`);
  lastRun = parsed.value;
}

const now = new Date();
const start = windowStart({ lastRun, now });
const days = windowDays({ start, now });
const entries = await newEntries(lastRun?.watermark ?? null);
const watchText = await readOptional(watchListPath);
const packet: Packet = {
  runId, windowStart: start, windowEnd: now.toISOString(), skillUsageDays: days, watermark: lastRun?.watermark ?? null,
  entries, ...(await skillUsage(days)), bugs: await escapedBugs(start), watchListPath,
  watchList: watchText === null ? null : parseStored(watchText, watchListSchema),
};

async function record(packetPath: string | null): Promise<void> {
  const next: LastRun = {
    ranAt: packet.windowEnd,
    watermark: nextWatermark(lastRun?.watermark ?? null, entries.map((e) => e.timestamp)),
    entries: entries.length,
    packet: packetPath,
  };
  if (dryRun) console.log(`[retrospective] dry run: would record ${JSON.stringify(next)}`);
  else await fs.writeFile(lastRunFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

if (!hasWork(packet)) {
  await record(null);
  process.exit(0);
}

const text = formatPacket(packet);
const packetPath = path.join(stateDir, "packets", `${runId}.md`);
if (dryRun) {
  console.log(`[retrospective] dry run: would write ${packetPath}; the handoff below is printed, not recorded.`);
} else {
  await fs.mkdir(path.dirname(packetPath), { recursive: true });
  await fs.writeFile(packetPath, text, "utf8");
}
const open = packet.bugs.filter((b) => !b.hasPrevention).length;
await execa(
  path.join(REPO_ROOT, "bin", "schedules"),
  ["handoff", "--title", `Retrospective: ${String(entries.length)} entries, ${String(open)} escaped bugs without prevention`, "--body", "-"],
  { input: `Packet saved at \`${packetPath}\`.\n\n${text}`, stdout: "inherit", stderr: "inherit" },
);
await record(packetPath);
