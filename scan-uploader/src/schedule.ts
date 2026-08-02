/**
 * The `schedule` subcommand's core: launchd plist generation/parsing, path
 * resolution, and the install/uninstall/status flows. All `launchctl`
 * invocations go through the injected {@link LaunchctlRunner} so this file
 * never spawns a process itself — the real implementation is
 * `launchctl.ts`; tests inject a fake that records invocations. Free of
 * other process globals too (uid, home directory, node/bundle paths are all
 * parameters) so it's directly doctestable; `schedule-cli.ts` owns
 * `process.argv`/`process.cwd`/`process.getuid`/platform and calls into
 * this.
 */

import { readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "./config.js";
import { writeFileAtomic } from "./atomic-write.js";
import { errorMessage, isErrnoException } from "./error-guards.js";
import { ScheduleError } from "./errors.js";

export const LABEL = "org.callback-box.scan-uploader";
export const DEFAULT_INTERVAL_MINUTES = 15;

export function plistPath(homeDir: string): string {
  return join(homeDir, "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function logPath(homeDir: string): string {
  return join(homeDir, "Library", "Logs", "scan-uploader.log");
}

export function domainTarget(uid: number): string {
  return `gui/${String(uid)}`;
}

export function serviceTarget(uid: number): string {
  return `${domainTarget(uid)}/${LABEL}`;
}

/** Same posture as the `trash` disposition (`config.ts`'s
 * `requireDisposition`): refuse outright rather than pretend to work. */
export function requireDarwin(platform: string): void {
  if (platform !== "darwin") {
    const message = `scan-uploader schedule is only supported on macOS (this machine is "${platform}")`;
    throw new ScheduleError(message);
  }
}

export interface LaunchctlResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LaunchctlRunner {
  run(args: readonly string[]): Promise<LaunchctlResult>;
}

export interface PlistParams {
  readonly nodePath: string;
  readonly bundlePath: string;
  readonly configPath: string;
  readonly intervalSeconds: number;
  readonly logPath: string;
}

export function generatePlist(params: PlistParams): string {
  const programArguments = [params.nodePath, params.bundlePath, params.configPath];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${xmlEscape(LABEL)}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...programArguments.map((argument) => `\t\t<string>${xmlEscape(argument)}</string>`),
    "\t</array>",
    "\t<key>StartInterval</key>",
    `\t<integer>${String(params.intervalSeconds)}</integer>`,
    "\t<key>RunAtLoad</key>",
    "\t<true/>",
    "\t<key>StandardOutPath</key>",
    `\t<string>${xmlEscape(params.logPath)}</string>`,
    "\t<key>StandardErrorPath</key>",
    `\t<string>${xmlEscape(params.logPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ];
  return lines.join("\n");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Reads `StartInterval` back out of a plist this module generated. Not a
 * general plist parser — deliberately just enough regex to read back what
 * `generatePlist` wrote (no new dependency for a real XML/plist parser). */
export function parseIntervalSeconds(plistXml: string): number | undefined {
  const match = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(plistXml);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  return Number(raw);
}

export interface ScheduleContext {
  readonly homeDir: string;
  readonly uid: number;
  readonly runner: LaunchctlRunner;
}

export interface InstallParams extends ScheduleContext {
  readonly configPath: string;
  readonly nodePath: string;
  readonly bundlePath: string;
  readonly intervalMinutes: number;
}

export interface InstallResult {
  readonly plistPath: string;
  readonly logPath: string;
  readonly intervalMinutes: number;
}

/** Refuses to install if `configPath` doesn't exist or fails the strict
 * reader — an installed schedule pointing at a broken config is a
 * silent-failure machine (it would just print errors into a log file no one
 * is watching). Writes the plist atomically, then always attempts a
 * `bootout` first (tolerating failure — it may not be loaded yet) before
 * `bootstrap`, so re-installing over an already-loaded agent reloads it
 * with the new plist rather than erroring. */
export async function installSchedule(params: InstallParams): Promise<InstallResult> {
  await requireValidConfig(params.configPath);
  const intervalSeconds = params.intervalMinutes * 60;
  const path = plistPath(params.homeDir);
  const log = logPath(params.homeDir);
  const plist = generatePlist({
    nodePath: params.nodePath,
    bundlePath: params.bundlePath,
    configPath: params.configPath,
    intervalSeconds,
    logPath: log,
  });
  await writeFileAtomic(path, { contents: plist });
  await params.runner.run(["bootout", serviceTarget(params.uid)]);
  const bootstrap = await params.runner.run(["bootstrap", domainTarget(params.uid), path]);
  if (bootstrap.code !== 0) {
    const message =
      `launchctl bootstrap failed (exit ${String(bootstrap.code)}): ` +
      `${bootstrap.stderr.trim().length > 0 ? bootstrap.stderr.trim() : bootstrap.stdout.trim()} ` +
      `— the plist was written to ${path} but is not loaded; fix the issue and re-run install`;
    throw new ScheduleError(message);
  }
  return { plistPath: path, logPath: log, intervalMinutes: params.intervalMinutes };
}

async function requireValidConfig(configPath: string): Promise<void> {
  try {
    await loadConfig(configPath);
  } catch (e) {
    const message = `refusing to install: config at ${configPath} is missing or invalid: ${errorMessage(e)}`;
    throw new ScheduleError(message);
  }
}

export interface UninstallResult {
  readonly wasInstalled: boolean;
  readonly plistPath: string;
}

export async function uninstallSchedule(params: ScheduleContext): Promise<UninstallResult> {
  const path = plistPath(params.homeDir);
  const existed = await pathExists(path);
  // Tolerated: bootout fails (non-zero) when the agent isn't currently
  // loaded, which is the normal case for a second uninstall.
  await params.runner.run(["bootout", serviceTarget(params.uid)]);
  if (existed) {
    await unlink(path);
  }
  return { wasInstalled: existed, plistPath: path };
}

export interface StatusResult {
  readonly plistPath: string;
  readonly plistPresent: boolean;
  readonly loaded: boolean;
  readonly intervalMinutes: number | undefined;
  readonly logPath: string;
  readonly logPresent: boolean;
  readonly logModifiedAt: Date | undefined;
}

export async function scheduleStatus(params: ScheduleContext): Promise<StatusResult> {
  const path = plistPath(params.homeDir);
  const log = logPath(params.homeDir);
  const plistText = await readTextOrUndefined(path);
  const intervalSeconds = plistText !== undefined ? parseIntervalSeconds(plistText) : undefined;
  const printResult = await params.runner.run(["print", serviceTarget(params.uid)]);
  const logStats = await statOrUndefined(log);
  return {
    plistPath: path,
    plistPresent: plistText !== undefined,
    loaded: printResult.code === 0,
    intervalMinutes: intervalSeconds !== undefined ? intervalSeconds / 60 : undefined,
    logPath: log,
    logPresent: logStats !== undefined,
    logModifiedAt: logStats?.mtime,
  };
}

async function pathExists(path: string): Promise<boolean> {
  return (await statOrUndefined(path)) !== undefined;
}

async function readTextOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") return undefined;
    throw e;
  }
}

async function statOrUndefined(path: string): Promise<{ mtime: Date } | undefined> {
  try {
    return await stat(path);
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") return undefined;
    throw e;
  }
}
