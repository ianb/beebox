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
import { existsSync } from "node:fs";
import { execa } from "execa";

const TICK_LABEL = "com.callback-box.schedules";
/** Retired per-job labels; install boots them out so nothing double-runs. */
const SUPERSEDED_LABELS = ["com.callback-box.sdk-update", "com.callback-box.manual-tests"];
const TICK_INTERVAL_SECONDS = 900;

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${TICK_LABEL}.plist`);
}

function logFile(): string {
  return path.join(os.homedir(), "Library", "Logs", "callback-box-schedules.log");
}

/**
 * launchd starts jobs with a PATH of `/usr/bin:/bin:/usr/sbin:/sbin` — no
 * version-managed node, no `~/.local/bin` agent CLIs. Without this, the tick
 * died on `exec: node: not found` at every interval and nothing ever ran
 * (found 2026-08-25, after the tick had "never" ticked). Baked at install from
 * the node that ran `install` and the agent CLIs it can see; a node upgrade
 * that moves the binary needs `bin/schedules install` again — `bin/doctor`'s
 * stale-heartbeat check is what notices.
 */
export function tickPath(input: { execPath: string; env: NodeJS.ProcessEnv }): string {
  const dirs = [path.dirname(input.execPath), path.join(os.homedir(), ".local", "bin")];
  for (const cli of ["claude", "codex"]) {
    const found = (input.env.PATH ?? "").split(":").find((d) => d !== "" && existsSync(path.join(d, cli)));
    if (found !== undefined) dirs.push(found);
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  return [...new Set(dirs)].join(":");
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function plistBody(input: { repoRoot: string; log: string; pathEnv: string }): string {
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
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xmlEscape(input.pathEnv)}</string></dict>
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

/**
 * A scheduled claude session hands its schedule's `prompt.md` over with
 * `--append-system-prompt-file`; without that flag every workstream schedule
 * would run promptless and nobody would find out until 03:00 on a Sunday. The
 * `bin/manual-tests-scheduled.sh:148` precedent guards install on the flag it
 * needs — this does the same, by ARGV PROBE rather than by grepping `--help`:
 * the flag is real (2.1.243 accepts it) but `claude --help` lists only
 * `--append-system-prompt`, mentioning the `-file` form solely inside another
 * option's prose. The probe adds a sentinel flag so the CLI always refuses
 * before doing any work, and reads WHICH flag it names as unknown.
 */
async function refuseWithoutSystemPromptFile(): Promise<string | null> {
  const probe = await execa(
    "claude",
    ["-p", "--append-system-prompt-file", "/dev/null", "--schedules-install-probe"],
    { reject: false },
  );
  if (probe.exitCode === undefined || probe.stderr === undefined) {
    return "the Claude CLI could not be run — install it, or put it on PATH";
  }
  if (probe.stderr.includes("--append-system-prompt-file")) {
    return "this Claude CLI has no --append-system-prompt-file; a scheduled workstream cannot be given its prompt";
  }
  return null;
}

export async function installTick(input: { repoRoot: string }): Promise<number> {
  const refusal = await refuseFromWorktree(input.repoRoot);
  if (refusal !== null) {
    process.stderr.write(`schedules install: ${refusal}\n`);
    return 1;
  }
  const flagRefusal = await refuseWithoutSystemPromptFile();
  if (flagRefusal !== null) {
    process.stderr.write(`schedules install: ${flagRefusal}\n`);
    return 1;
  }
  const target = domainTarget();
  const file = plistPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.mkdir(path.dirname(logFile()), { recursive: true });
  await fs.writeFile(file, plistBody({
      repoRoot: input.repoRoot,
      log: logFile(),
      pathEnv: tickPath({ execPath: process.execPath, env: process.env }),
    }), "utf8");

  // Boot the retired jobs out AND delete their plists. A booted-out label whose
  // file survives comes back at the next login — the plist is what launchd
  // loads, so leaving it behind means the SDK job runs twice a day from two
  // mechanisms and nobody finds out until the ledger has two entries per
  // release.
  for (const label of SUPERSEDED_LABELS) {
    await launchctl(["bootout", `${target}/${label}`]);
    await fs.rm(path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`), { force: true });
  }
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
