/**
 * Close a journey run: read what actually landed, independently of what the walker says.
 *
 * The notes are one person's account, written in character, by someone who may sincerely
 * believe they filed their things and did not. So the outcome is read off the box — its
 * commits, its new files — rather than taken from the report. A run where the narrative
 * and the disk disagree is the single most interesting thing this whole exercise can find.
 *
 * Usage: pnpm exec tsx callback-box/user-stories/journeys/collect.ts <run-id>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../src/lib/is-record.ts";
import { parseJsonLine, readJson } from "../pipeline/json-io.ts";

const HERE = import.meta.dirname;
const WORK = join(HERE, "../work/journeys");

const runId = process.argv[2];
if (runId === undefined) {
  console.error("usage: collect.ts <run-id>   (a directory under user-stories/work/journeys/)");
  process.exit(1);
}

const runDir = join(WORK, runId);
if (!existsSync(join(runDir, "before.json"))) {
  console.error(`no run at ${runDir} — prepare.ts writes before.json`);
  process.exit(1);
}

interface Before { journey: string, startedIso: string, box: string, url: string, headBefore: string }
const before = readJson<Before>(join(runDir, "before.json"));

function git(args: string[]): string {
  return execFileSync("git", ["-C", before.box, ...args], { encoding: "utf8" }).trim();
}

const headAfter = git(["rev-parse", "HEAD"]);
const commits = before.headBefore === headAfter
  ? []
  : git(["log", "--format=%h %s", `${before.headBefore}..HEAD`]).split("\n").filter(Boolean);
const untracked = git(["status", "--porcelain"]).split("\n").filter(Boolean);

const shots = existsSync(join(runDir, "shots"))
  ? readdirSync(join(runDir, "shots")).filter((f) => f.endsWith(".png"))
  : [];
const notesPath = join(runDir, "notes.md");
const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "";

/**
 * Timing comes from the screenshot sidecars, never from the notes.
 *
 * The walker stamps its own entries and has no sense of duration: one wrote "after
 * about 20 minutes" into a session that had run six and a half, then caught itself
 * and said every stamp above was a guess. `bin/browse` writes a real UTC timestamp
 * beside each screenshot, which is a clock the person in character cannot invent.
 *
 * Total span is reported but is NOT the product's latency — most of it is the walker
 * navigating and writing notes, which no real person does. The gaps between
 * consecutive screenshots are the useful number: a long one is someone waiting.
 */
interface Sidecar { timestamp: string, url: string }
const shotDir = join(runDir, "shots");
const sidecars = existsSync(shotDir)
  ? readdirSync(shotDir).filter((f) => f.endsWith(".png.json")).toSorted()
  : [];
const marks = sidecars.map((f) => ({
  name: f.slice(0, -9),
  at: new Date(readJson<Sidecar>(join(shotDir, f)).timestamp),
}));

const spanMinutes = marks.length >= 2
  ? (marks[marks.length - 1]!.at.getTime() - marks[0]!.at.getTime()) / 60000
  : 0;
const waits = marks
  .slice(1)
  .map((m, i) => ({ from: marks[i]!.name, to: m.name, seconds: (m.at.getTime() - marks[i]!.at.getTime()) / 1000 }))
  .filter((w) => w.seconds > 45)
  .toSorted((a, b) => b.seconds - a.seconds);
const elapsed = marks.length >= 2
  ? `${spanMinutes.toFixed(1)} min wall clock, ${waits.length} wait(s) over 45s`
  : "no screenshots — timing unavailable";

/**
 * What the PERSON actually waited on, with the walker subtracted.
 *
 * Screenshot gaps include the walker composing prose and appending 500 lines of
 * notes, which no real person does — measuring those would blame the product for
 * the instrument. The box's own agent transcripts carry a timestamp per entry, so
 * a turn's latency is exactly (their message → the reply), and nothing else.
 *
 * On the run this was written for: 18 turns, median 10s, slowest 58s, 4.1 min of
 * agent time inside a 13.7 min session — while the walker, watching a spinner with
 * no scale, recorded "after about 20 minutes".
 */
function agentTurns(boxContent: string): number[] {
  const encoded = boxContent.replaceAll("/", "-");
  const dir = join(homedir(), ".claude", "projects", encoded);
  if (!existsSync(dir)) return [];
  const out: number[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    let started: number | null = null;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let entry: { timestamp?: string, type?: string, message?: { content?: unknown } };
      try {
        entry = parseJsonLine(line);
      } catch (_e) { continue; }
      const stamp = entry.timestamp;
      if (stamp === undefined) continue;
      const at = new Date(stamp).getTime();
      const content = entry.message?.content;
      const kinds = Array.isArray(content)
        ? content.map((b) => (isRecord(b) ? String(b["type"]) : ""))
        : [];
      if (entry.type === "user" && !kinds.includes("tool_result")) started = at;
      else if (entry.type === "assistant" && started !== null && kinds.includes("text")) {
        out.push((at - started) / 1000);
        started = null;
      }
    }
  }
  return out;
}

const turns = agentTurns(join(before.box, "content"));
const sorted = turns.toSorted((a, b) => a - b);
const agentSeconds = turns.reduce((n, t) => n + t, 0);

const after = {
  ...before,
  finishedIso: new Date().toISOString(),
  headAfter,
  commits,
  untracked,
  screenshots: shots.length,
  noteLines: notes === "" ? 0 : notes.split("\n").length,
  spanMinutes: Number(spanMinutes.toFixed(1)),
  agentTurns: turns.length,
  agentMinutes: Number((agentSeconds / 60).toFixed(1)),
  agentMedianSeconds: sorted.length === 0 ? 0 : Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
  agentSlowestSeconds: sorted.length === 0 ? 0 : Math.round(sorted.at(-1) ?? 0),
  waitsOver45s: waits,
};
writeFileSync(join(runDir, "after.json"), `${JSON.stringify(after, null, 2)}\n`);

console.log(`journey     ${before.journey}`);
console.log(`box         ${before.box}`);
console.log(`walked      ${elapsed}`);
for (const w of waits.slice(0, 6)) {
  console.log(`  ${String(Math.round(w.seconds)).padStart(4)}s  ${w.from} → ${w.to}`);
}
if (waits.length > 0) {
  console.log("  (screenshot sidecars, not the walker's own stamps — it has no sense of duration)");
}
if (turns.length > 0) {
  console.log(`agent       ${turns.length} turns, ${(agentSeconds / 60).toFixed(1)} min total, median ${after.agentMedianSeconds}s, slowest ${after.agentSlowestSeconds}s`);
  console.log("            (what the person waited on; the rest of the span is the walker)");
}
console.log(`notes       ${after.noteLines} lines`);
console.log(`screenshots ${shots.length}`);
console.log("");
if (commits.length === 0) {
  console.log("NOTHING WAS COMMITTED. If the notes claim otherwise, that is the finding.");
} else {
  console.log(`the box recorded ${commits.length} commit(s) — this is what actually landed:`);
  for (const c of commits) console.log(`  ${c}`);
}
if (untracked.length > 0) {
  console.log(`\n${untracked.length} uncommitted path(s) left behind:`);
  for (const u of untracked.slice(0, 10)) console.log(`  ${u}`);
}
