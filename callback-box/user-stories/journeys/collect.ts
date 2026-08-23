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

// Timestamps the walker wrote into its own notes, so wall-clock can be judged from
// outside rather than asked of someone with no sense of duration.
const stamps = [...notes.matchAll(/^##\s+(\d{2}:\d{2}(?::\d{2})?)/gmu)].map((m) => m[1] ?? "");
const elapsed = stamps.length >= 2 ? `${stamps[0]} → ${stamps.at(-1)}` : "not recorded";

const after = {
  ...before,
  finishedIso: new Date().toISOString(),
  headAfter,
  commits,
  untracked,
  screenshots: shots.length,
  noteLines: notes === "" ? 0 : notes.split("\n").length,
  walkerTimestamps: elapsed,
};
writeFileSync(join(runDir, "after.json"), `${JSON.stringify(after, null, 2)}\n`);

console.log(`journey     ${before.journey}`);
console.log(`box         ${before.box}`);
console.log(`walked      ${elapsed} (by the walker's own stamps)`);
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
