/**
 * The one launchd job: `com.callback-box.schedules`, a 15-minute
 * `StartInterval` tick. It replaces the two hand-rolled per-job plists
 * (`bin/update-agent-sdk-scheduled.sh`, `bin/manual-tests-scheduled.sh`), so
 * installing also boots those labels out — two mechanisms both running the SDK
 * job is exactly the transition state the plan calls out.
 *
 * `StartInterval` (not `StartCalendarInterval`) because due-ness is computed
 * from persisted state, not from the wall clock: firings missed during sleep
 * are simply missed, and the next tick after wake catches up once.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

export const TICK_LABEL = "com.callback-box.schedules";
/** Retired per-job labels; install boots them out so nothing double-runs. */
const SUPERSEDED_LABELS = ["com.callback-box.sdk-update", "com.callback-box.manual-tests"];
const TICK_INTERVAL_SECONDS = 900;

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${TICK_LABEL}.plist`);
}

function logFile(): string {
  return path.join(os.homedir(), "Library", "Logs", "callback-box-schedules.log");
}

function plistBody(input: { repoRoot: string; log: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${TICK_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${input.repoRoot}/bin/schedules</string>
    <string>tick</string>
  </array>
  <key>StartInterval</key><integer>${String(TICK_INTERVAL_SECONDS)}</integer>
  <key>StandardOutPath</key><string>${input.log}</string>
  <key>StandardErrorPath</key><string>${input.log}</string>
</dict>
</plist>
`;
}

async function launchctl(args: string[]): Promise<number | null> {
  const result = await execa("launchctl", args, { reject: false });
  return result.exitCode ?? null;
}

function domainTarget(): string {
  return `gui/${String(os.userInfo().uid)}`;
}

/**
 * Refuse from a worktree: the plist embeds the checkout path and a worktree
 * evaporates when its session ends (the `update-agent-sdk-scheduled.sh:52`
 * precedent).
 */
async function refuseFromWorktree(repoRoot: string): Promise<string | null> {
  const gitDir = await execa("git", ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-dir"]);
  const common = await execa("git", ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (gitDir.stdout.trim() !== common.stdout.trim()) {
    return `refusing to install from a worktree (${repoRoot}) — run this from the main checkout`;
  }
  return null;
}

export async function installTick(input: { repoRoot: string }): Promise<number> {
  const refusal = await refuseFromWorktree(input.repoRoot);
  if (refusal !== null) {
    process.stderr.write(`schedules install: ${refusal}\n`);
    return 1;
  }
  const target = domainTarget();
  const file = plistPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.mkdir(path.dirname(logFile()), { recursive: true });
  await fs.writeFile(file, plistBody({ repoRoot: input.repoRoot, log: logFile() }), "utf8");

  for (const label of SUPERSEDED_LABELS) await launchctl(["bootout", `${target}/${label}`]);
  await launchctl(["bootout", `${target}/${TICK_LABEL}`]);
  const code = await launchctl(["bootstrap", target, file]);
  if (code !== 0) {
    process.stderr.write(`schedules install: launchctl bootstrap exited ${String(code)}\n`);
    return 1;
  }
  process.stdout.write(`Installed ${TICK_LABEL} (every ${String(TICK_INTERVAL_SECONDS / 60)} min, repo: ${input.repoRoot}).\nLogs: ${logFile()}\n`);
  return 0;
}

export async function uninstallTick(): Promise<number> {
  const target = domainTarget();
  await launchctl(["bootout", `${target}/${TICK_LABEL}`]);
  await fs.rm(plistPath(), { force: true });
  process.stdout.write(`Removed ${TICK_LABEL}.\n`);
  return 0;
}
