/**
 * Disk hygiene for the development Mac: prune caches that only grow, and
 * alert when free space stays low after pruning.
 *
 * Every pruned cache is rebuildable, so pruning needs no judgment:
 *   - `uv cache prune` drops unreferenced Python wheels/archives (reached 31 GB).
 *   - `pnpm store prune` drops unreferenced store packages (reached 62 GB).
 *     With `package-import-method: clone-or-copy` on APFS, installed packages
 *     are clones, not hard links, so prune sees nothing as referenced and
 *     empties the store. Existing `node_modules` keep working; the next
 *     install downloads again.
 *   - `xcrun simctl --set testing delete all` removes parallel-test simulator
 *     clones that xcodebuild leaves behind.
 *
 * Runs daily so the low-disk check is timely; prunes at most weekly (or at
 * once when space is low). Skips a prune while its tool is in use: a pnpm
 * install or an xcodebuild run would lose files from under it.
 *
 * Silent on success; the store's `lastRunAt` records that it ran.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");
const SCHEDULES_CLI = path.join(REPO_ROOT, "bin", "schedules");

const LOW_DISK_GB = 50;
const PRUNE_EVERY_DAYS = 7;
const LOW_DISK_CONDITION = "low-disk";

const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined) {
  process.stderr.write("disk-hygiene: SCHEDULE_STATE_DIR is not set; run through bin/schedules\n");
  process.exit(2);
}
const lastPruneFile = path.join(stateDir, "last-prune.txt");

/** Free space on the volume that holds the home directory (the APFS Data volume). */
function freeGb(): number {
  const stats = fs.statfsSync(os.homedir());
  return (stats.bavail * stats.bsize) / 1024 ** 3;
}

function daysSinceLastPrune(): number {
  if (!fs.existsSync(lastPruneFile)) return Number.POSITIVE_INFINITY;
  const last = new Date(fs.readFileSync(lastPruneFile, "utf-8").trim()).getTime();
  return Number.isNaN(last) ? Number.POSITIVE_INFINITY : (Date.now() - last) / 86_400_000;
}

/** True when a process whose full command line matches `pattern` is running. */
async function running(pattern: string): Promise<boolean> {
  const result = await execa("pgrep", ["-f", pattern], { reject: false });
  return result.exitCode === 0;
}

interface Prune {
  name: string;
  command: [string, ...string[]];
  /** A pgrep -f pattern; the prune is skipped while it matches. */
  busy: string;
}

const PRUNES: Prune[] = [
  { name: "uv cache", command: ["uv", "cache", "prune"], busy: String.raw`(^|/)uv (pip|sync|run|tool|cache)` },
  { name: "pnpm store", command: ["pnpm", "store", "prune"], busy: String.raw`pnpm(\.cjs)? (install|i|add|update)( |$)` },
  {
    name: "test simulator clones",
    command: ["xcrun", "simctl", "--set", "testing", "delete", "all"],
    busy: "xcodebuild",
  },
];

/** Runs each prune; returns the names skipped because their tool was busy. A
 *  failing prune throws: a broken prune is a broken watch, and the runner's
 *  failed-run alert carries the log tail. */
async function pruneAll(): Promise<string[]> {
  const skipped: string[] = [];
  for (const prune of PRUNES) {
    if (await running(prune.busy)) {
      skipped.push(prune.name);
      continue;
    }
    if (dryRun) {
      console.log(`[disk-hygiene] would run: ${prune.command.join(" ")}`);
      continue;
    }
    const [file, ...args] = prune.command;
    await execa(file, args, { stdio: "ignore" });
  }
  if (!dryRun && skipped.length === 0) fs.writeFileSync(lastPruneFile, `${new Date().toISOString()}\n`);
  return skipped;
}

const before = freeGb();
let skipped: string[] = [];
if (before < LOW_DISK_GB || daysSinceLastPrune() >= PRUNE_EVERY_DAYS) skipped = await pruneAll();
const after = freeGb();

if (after >= LOW_DISK_GB) {
  // `resolve` honors SCHEDULE_DRY_RUN itself.
  await execa(SCHEDULES_CLI, ["resolve", "--condition", LOW_DISK_CONDITION], { stdio: "inherit" });
  process.exit(0);
}

const message = [
  `**${after.toFixed(1)} GB free** after pruning (threshold ${String(LOW_DISK_GB)} GB; ${before.toFixed(1)} GB before).`,
  "",
  "The rebuildable caches are pruned; what remains needs a person to choose. Usual large items:",
  "- `~/Library/Developer/Xcode/iOS DeviceSupport` — one ~5.6 GB folder per phone iOS version; keep the newest",
  "- `~/src/beebox-worktrees` — `bin/workstreams sweep`, or `remove --force --keep-branch` for idle ones",
  "- `~/Library/Caches` and `~/Library/Application Support` — per-app caches and experiments",
  ...(skipped.length > 0 ? ["", `Skipped while in use: ${skipped.join(", ")}.`] : []),
].join("\n");

if (dryRun) {
  console.log("[disk-hygiene] would alert (important): Disk space is low");
  console.log(message);
  process.exit(0);
}
await execa(
  SCHEDULES_CLI,
  ["alert", "--priority", "important", "--condition", LOW_DISK_CONDITION, "--title", "Disk space is low", "--message", message],
  { stdio: "inherit" },
);
