/**
 * argv parsing and process-facing dispatch for the `schedule` subcommand.
 * Owns everything `schedule.ts` deliberately doesn't: `process.platform`,
 * `process.argv`, `process.cwd`, `process.execPath`, `process.getuid`, and
 * the real `launchctl` runner (`launchctl.ts`).
 */

import { homedir } from "node:os";
import { resolve } from "node:path";

import { resolveConfigPath } from "./config-path.js";
import { errorMessage } from "./error-guards.js";
import { ScheduleError } from "./errors.js";
import { RealLaunchctlRunner } from "./launchctl.js";
import {
  DEFAULT_INTERVAL_MINUTES,
  installSchedule,
  requireDarwin,
  scheduleStatus,
  uninstallSchedule,
  type InstallResult,
  type StatusResult,
  type UninstallResult,
} from "./schedule.js";

export function printScheduleHelp(): void {
  console.log(
    [
      "Usage: scan-uploader schedule <install|uninstall|status> [options]",
      "",
      "Manages a macOS launchd LaunchAgent that periodically sweeps the",
      "configured folders — a safety net alongside the ScanSnap post-scan",
      "hook (the check endpoint's dedup makes overlap harmless). macOS only.",
      "",
      "  install [--interval <minutes>] [--config <path>]",
      "      writes ~/Library/LaunchAgents/org.callback-box.scan-uploader.plist",
      `      (default interval: ${String(DEFAULT_INTERVAL_MINUTES)} minutes) and loads it; refuses if`,
      "      the config file is missing or fails the strict reader",
      "  uninstall",
      "      unloads and removes the LaunchAgent (idempotent — a second",
      "      uninstall reports \"not installed\" and exits 0)",
      "  status",
      "      reports whether the LaunchAgent is present/loaded, its",
      "      configured interval, and the log file's last-modified time",
      "",
      "  -h, --help  show this help",
    ].join("\n"),
  );
}

/** Parses a positive-integer minute count for `--interval`. A plain
 * function (no process globals) so it's directly doctestable, mirroring
 * `configure-cli.ts`'s `parseDisposition`. */
export function parseIntervalMinutes(value: string | undefined): number {
  if (value === undefined) return DEFAULT_INTERVAL_MINUTES;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    const message = `--interval must be a positive integer number of minutes (got "${value}")`;
    throw new ScheduleError(message);
  }
  return Number(value);
}

interface ActionFlags {
  readonly interval: string | undefined;
  readonly configPath: string | undefined;
}

/** Parses `install`'s `--interval`/`--config` flags. Mirrors
 * `configure-cli.ts`'s `parseConfigureArgs`: a value that looks like
 * another flag (starts with `--`) is never silently consumed as this
 * flag's value. */
function parseActionFlags(args: readonly string[]): ActionFlags {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const flagName = arg.slice(2);
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      const message = `--${flagName} requires a value`;
      throw new ScheduleError(message);
    }
    flags.set(flagName, value);
    i += 1;
  }
  return { interval: flags.get("interval"), configPath: flags.get("config") };
}

export async function runScheduleCommand(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printScheduleHelp();
    return 0;
  }
  try {
    requireDarwin(process.platform);
    return await dispatchAction(args);
  } catch (e) {
    console.error(`scan-uploader schedule: ${errorMessage(e)}`);
    return 1;
  }
}

async function dispatchAction(args: readonly string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action === "install") return runInstall(rest);
  if (action === "uninstall") return runUninstall();
  if (action === "status") return runStatus();
  const message = `unknown action "${action ?? "(none)"}" — expected install, uninstall, or status`;
  throw new ScheduleError(message);
}

async function runInstall(args: readonly string[]): Promise<number> {
  const flags = parseActionFlags(args);
  const intervalMinutes = parseIntervalMinutes(flags.interval);
  const homeDir = homedir();
  const configPath =
    flags.configPath !== undefined
      ? resolve(process.cwd(), flags.configPath)
      : await resolveConfigPath({ cwd: process.cwd(), homeDir });
  const result = await installSchedule({
    homeDir,
    uid: requireUid(),
    runner: new RealLaunchctlRunner(),
    configPath,
    execPath: process.execPath,
    entryPath: resolveEntryPath(),
    intervalMinutes,
  });
  printInstallResult(result);
  return 0;
}

async function runUninstall(): Promise<number> {
  const result = await uninstallSchedule({
    homeDir: homedir(),
    uid: requireUid(),
    runner: new RealLaunchctlRunner(),
  });
  printUninstallResult(result);
  return 0;
}

async function runStatus(): Promise<number> {
  const result = await scheduleStatus({
    homeDir: homedir(),
    uid: requireUid(),
    runner: new RealLaunchctlRunner(),
  });
  printStatusResult(result);
  return 0;
}

/** The absolute path of the currently-running entry point — `.ts` on a
 * checkout run (`bin/scan-uploader` execs tsx against `src/cli.ts`), `.mjs`
 * when running a copied `dist/scan-uploader.mjs` bundle. Determines
 * source-vs-bundle mode (`schedule.ts`'s `detectRunMode`). */
function resolveEntryPath(): string {
  const argv1 = process.argv[1];
  if (argv1 === undefined) {
    const message = "could not resolve the running script's path from process.argv[1]";
    throw new ScheduleError(message);
  }
  return resolve(argv1);
}

function requireUid(): number {
  if (process.getuid === undefined) {
    const message = "process.getuid is unavailable on this platform";
    throw new ScheduleError(message);
  }
  return process.getuid();
}

function printInstallResult(result: InstallResult): void {
  console.log(`scheduled: every ${String(result.intervalMinutes)} minutes`);
  console.log(`  plist: ${result.plistPath}`);
  console.log(`  log:   ${result.logPath}`);
}

function printUninstallResult(result: UninstallResult): void {
  if (!result.wasInstalled) {
    console.log(`not installed: ${result.plistPath}`);
    return;
  }
  console.log(`uninstalled: ${result.plistPath}`);
}

function printStatusResult(result: StatusResult): void {
  console.log(`plist: ${result.plistPresent ? "present" : "not present"} (${result.plistPath})`);
  console.log(`loaded: ${result.loaded ? "yes" : "no"}`);
  console.log(
    `interval: ${
      result.intervalMinutes !== undefined
        ? `${String(result.intervalMinutes)} minutes`
        : "(unknown — plist not present or unreadable)"
    }`,
  );
  console.log(
    `log: ${result.logPath} (${
      result.logPresent ? `last modified ${result.logModifiedAt?.toISOString() ?? "?"}` : "not present"
    })`,
  );
}
