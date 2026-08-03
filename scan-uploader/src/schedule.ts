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
import { dirname, join } from "node:path";

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
  readonly programArguments: readonly string[];
  /** Source-mode only: `bin/scan-uploader` execs tsx from wherever launchd
   * happens to run it, so the repo root needs to be pinned explicitly. */
  readonly workingDirectory?: string;
  /** Source-mode only: launchd's default `PATH` has no `node` on it (the
   * wrapper's `exec "$TSX" …` needs one to run at all), so the directory
   * holding the `node` binary that resolved `tsx` is added explicitly. */
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly intervalSeconds: number;
  readonly logPath: string;
}

export function generatePlist(params: PlistParams): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${xmlEscape(LABEL)}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...params.programArguments.map((argument) => `\t\t<string>${xmlEscape(argument)}</string>`),
    "\t</array>",
    ...workingDirectoryLines(params.workingDirectory),
    ...environmentVariablesLines(params.environmentVariables),
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

function workingDirectoryLines(workingDirectory: string | undefined): string[] {
  if (workingDirectory === undefined) return [];
  return ["\t<key>WorkingDirectory</key>", `\t<string>${xmlEscape(workingDirectory)}</string>`];
}

function environmentVariablesLines(environmentVariables: Readonly<Record<string, string>> | undefined): string[] {
  if (environmentVariables === undefined) return [];
  const entryLines = Object.entries(environmentVariables).flatMap(([key, value]) => [
    `\t\t<key>${xmlEscape(key)}</key>`,
    `\t\t<string>${xmlEscape(value)}</string>`,
  ]);
  return ["\t<key>EnvironmentVariables</key>", "\t<dict>", ...entryLines, "\t</dict>"];
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

/** `bin/scan-uploader` (the wrapper) execs tsx directly against
 * `scan-uploader/src/cli.ts`, so `process.argv[1]` on a checkout run always
 * ends in `.ts`; a copied `dist/scan-uploader.mjs` run with plain `node`
 * ends in `.mjs`. Two possible values, so a suffix check is enough — no
 * need to inspect the filesystem just to tell them apart. */
export type RunMode = "source" | "bundle";

export function detectRunMode(entryPath: string): RunMode {
  return entryPath.endsWith(".ts") ? "source" : "bundle";
}

export interface LaunchdInvocation {
  readonly programArguments: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentVariables?: Readonly<Record<string, string>>;
}

export interface ResolveLaunchdInvocationParams {
  /** `process.argv[1]`, already resolved to an absolute path. */
  readonly entryPath: string;
  /** `process.execPath`. */
  readonly execPath: string;
  readonly configPath: string;
}

/**
 * Builds the launchd-facing invocation for whichever mode `entryPath`
 * indicates. Bundle mode is unchanged from before source-mode existed:
 * `[execPath, entryPath, configPath]`, no working directory or env — the
 * bundle is self-contained and portable. Source mode instead runs through
 * the repo-root wrapper (which resolves and execs tsx itself), so the
 * schedule needs to hand launchd a repo root (`WorkingDirectory`) and a
 * `PATH` with a `node` on it (launchd's own default `PATH` has none —
 * that's what the wrapper's `exec "$TSX" …` needs to find `node` to run at
 * all).
 */
export async function resolveLaunchdInvocation(
  params: ResolveLaunchdInvocationParams,
): Promise<LaunchdInvocation> {
  if (detectRunMode(params.entryPath) === "bundle") {
    return { programArguments: [params.execPath, params.entryPath, params.configPath] };
  }
  return resolveSourceInvocation(params);
}

async function resolveSourceInvocation(params: ResolveLaunchdInvocationParams): Promise<LaunchdInvocation> {
  // entryPath: <repoRoot>/scan-uploader/src/cli.ts
  const srcDir = dirname(params.entryPath);
  const packageDir = dirname(srcDir);
  const repoRoot = dirname(packageDir);
  const wrapperPath = join(repoRoot, "bin", "scan-uploader");
  if (!(await pathExists(wrapperPath))) {
    const message =
      `expected the repo-root wrapper at ${wrapperPath} (derived from ${params.entryPath}), ` +
      "but it does not exist — source-mode scheduling only works from a full monorepo checkout";
    throw new ScheduleError(message);
  }
  return {
    programArguments: [wrapperPath, params.configPath],
    workingDirectory: repoRoot,
    environmentVariables: { PATH: `${dirname(params.execPath)}:/usr/bin:/bin` },
  };
}

export interface ScheduleContext {
  readonly homeDir: string;
  readonly uid: number;
  readonly runner: LaunchctlRunner;
}

export interface InstallParams extends ScheduleContext {
  readonly configPath: string;
  /** `process.execPath`. */
  readonly execPath: string;
  /** `process.argv[1]`, already resolved to an absolute path — determines
   * source vs. bundle mode (see {@link detectRunMode}). */
  readonly entryPath: string;
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
  const invocation = await resolveLaunchdInvocation({
    entryPath: params.entryPath,
    execPath: params.execPath,
    configPath: params.configPath,
  });
  const plist = generatePlist({ ...invocation, intervalSeconds, logPath: log });
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
