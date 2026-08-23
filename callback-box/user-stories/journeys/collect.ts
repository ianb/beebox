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
import { join } from "node:path";

import { readJson } from "../pipeline/json-io.ts";

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

const after = {
  ...before,
  finishedIso: new Date().toISOString(),
  headAfter,
  commits,
  untracked,
  screenshots: shots.length,
  noteLines: notes === "" ? 0 : notes.split("\n").length,
  spanMinutes: Number(spanMinutes.toFixed(1)),
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
