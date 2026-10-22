/**
 * `bin/apple-test` — one command for the Apple code's tests.
 *
 *   bin/apple-test [--package-only | --ios | --all] [--changed <path>...]
 *
 *   (no flag)       swift test in apple-shared/, then the mac-app check
 *   --package-only  apple-shared only
 *   --ios           apple-shared + the iOS simulator test run
 *   --all           everything
 *   --changed ...   pick steps from changed repo-relative paths (finish uses this)
 *
 * The mac-app check is `swift build` until mac-app/ has a Tests/ directory,
 * then `swift test`. The simulator is chosen from `simctl`, never by name.
 * Plan: beebox/docs/plans/mac-app-shell.md, section B.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Step = "shared" | "mac" | "ios";

export interface Options {
  steps: Step[];
  /** Set by --changed and no changed path is Apple code. */
  nothingToDo: boolean;
}

export class UsageError extends Error {
  constructor(readonly detail: string) {
    super(`bad arguments: ${detail}`);
    this.name = "UsageError";
  }
}

class ModeConflictError extends UsageError {
  constructor() {
    super("only one of --package-only, --ios, --all");
    this.name = "ModeConflictError";
  }
}

class UnknownOptionError extends UsageError {
  constructor(arg: string) {
    super(`unknown option ${arg}`);
    this.name = "UnknownOptionError";
  }
}

class UnexpectedArgumentError extends UsageError {
  constructor(arg: string) {
    super(`unexpected argument ${arg}`);
    this.name = "UnexpectedArgumentError";
  }
}

class ChangedWithModeError extends UsageError {
  constructor() {
    super("--changed cannot combine with a mode flag");
    this.name = "ChangedWithModeError";
  }
}

class NoChangedPathsError extends UsageError {
  constructor() {
    super("--changed needs at least one path");
    this.name = "NoChangedPathsError";
  }
}

const USAGE =
  "usage: bin/apple-test [--package-only | --ios | --all] [--changed <path>...]";

const ORDER: Step[] = ["shared", "mac", "ios"];

/** The steps a set of changed paths calls for. */
export function stepsForChanged(paths: string[]): Step[] {
  const steps = new Set<Step>();
  for (const path of paths) {
    if (path.startsWith("apple-shared/")) {
      steps.add("shared");
      steps.add("ios");
    } else if (path.startsWith("ios-app/")) {
      steps.add("ios");
    } else if (path.startsWith("mac-app/")) {
      steps.add("mac");
    }
  }
  return ORDER.filter((step) => steps.has(step));
}

export function parseArgs(argv: string[]): Options {
  let mode: "default" | "package-only" | "ios" | "all" = "default";
  let changed: string[] | undefined;
  let inChanged = false;
  for (const arg of argv) {
    if (arg === "--changed") {
      changed ??= [];
      inChanged = true;
    } else if (arg === "--package-only" || arg === "--ios" || arg === "--all") {
      if (mode !== "default") throw new ModeConflictError();
      mode =
        arg === "--package-only"
          ? "package-only"
          : arg === "--ios"
            ? "ios"
            : "all";
      inChanged = false;
    } else if (arg.startsWith("--")) {
      throw new UnknownOptionError(arg);
    } else if (inChanged && changed !== undefined) {
      changed.push(arg);
    } else {
      throw new UnexpectedArgumentError(arg);
    }
  }
  if (changed !== undefined) {
    if (mode !== "default") throw new ChangedWithModeError();
    if (changed.length === 0) throw new NoChangedPathsError();
    const steps = stepsForChanged(changed);
    return { steps, nothingToDo: steps.length === 0 };
  }
  const byMode: Record<typeof mode, Step[]> = {
    default: ["shared", "mac"],
    "package-only": ["shared"],
    ios: ["shared", "ios"],
    all: ["shared", "mac", "ios"],
  };
  return { steps: byMode[mode], nothingToDo: false };
}

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

/** Version parts of `com.apple.CoreSimulator.SimRuntime.iOS-26-5`, or undefined for non-iOS runtimes. */
function iosRuntimeVersion(runtime: string): number[] | undefined {
  const match = /\.SimRuntime\.iOS-(\d+(?:-\d+)*)$/.exec(runtime);
  return match?.[1]?.split("-").map(Number);
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function simDevices(json: unknown): Record<string, SimDevice[]> {
  const result: Record<string, SimDevice[]> = {};
  if (typeof json !== "object" || json === null || !("devices" in json))
    return result;
  const { devices } = json;
  if (typeof devices !== "object" || devices === null) return result;
  for (const [runtime, list] of Object.entries(devices)) {
    if (!Array.isArray(list)) continue;
    result[runtime] = list.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const udid: unknown = Reflect.get(entry, "udid");
      const name: unknown = Reflect.get(entry, "name");
      const state: unknown = Reflect.get(entry, "state");
      const isAvailable: unknown = Reflect.get(entry, "isAvailable");
      return typeof udid === "string" &&
        typeof name === "string" &&
        typeof state === "string" &&
        isAvailable === true
        ? [{ udid, name, state, isAvailable }]
        : [];
    });
  }
  return result;
}

/**
 * The simulator to test on, from `xcrun simctl list devices available --json`:
 * a booted iPhone if there is one, else the first available iPhone on the
 * newest iOS runtime. Returns undefined when no iPhone is available.
 */
export function chooseSimulator(
  json: unknown,
): { udid: string; name: string } | undefined {
  const devices = simDevices(json);
  const runtimes = Object.entries(devices)
    .flatMap(([runtime, list]) => {
      const version = iosRuntimeVersion(runtime);
      return version === undefined ? [] : [{ version, list }];
    })
    .toSorted((a, b) => compareVersions(b.version, a.version));
  const iphones = runtimes.map(({ list }) =>
    list.filter(
      (device) => device.isAvailable && device.name.startsWith("iPhone"),
    ),
  );
  const booted = iphones.flat().find((device) => device.state === "Booted");
  const pick = booted ?? iphones.find((list) => list.length > 0)?.[0];
  return pick === undefined ? undefined : { udid: pick.udid, name: pick.name };
}

/** True when `xcode-select -p` points inside a full Xcode (not Command Line Tools). */
export function isFullXcode(developerDir: string): boolean {
  return developerDir.trim().startsWith("/Applications/Xcode");
}

interface RunResult {
  code: number;
  output: string;
}

function run(
  argv: readonly [string, ...string[]],
  cwd: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) =>
      resolve({ code: 127, output: `${error.message}\n` }),
    );
    child.on("close", (code) =>
      resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString() }),
    );
  });
}

const REPO_ROOT = join(import.meta.dirname, "..");

interface StepSpec {
  label: string;
  argv: readonly [string, ...string[]];
  cwd: string;
}

async function runStep({ label, argv, cwd }: StepSpec): Promise<boolean> {
  const started = Date.now();
  const result = await run(argv, join(REPO_ROOT, cwd));
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (result.code === 0) {
    process.stdout.write(`ok   ${label} (${seconds}s)\n`);
    return true;
  }
  process.stdout.write(
    `FAIL ${label} (exit ${String(result.code)}, ${seconds}s): ${argv.join(" ")}\n`,
  );
  process.stdout.write(result.output);
  return false;
}

async function iosStep(): Promise<boolean> {
  const listed = await run(
    ["xcrun", "simctl", "list", "devices", "available", "--json"],
    REPO_ROOT,
  );
  if (listed.code !== 0) {
    process.stdout.write(`FAIL ios: simctl list failed\n${listed.output}`);
    return false;
  }
  const sim = chooseSimulator(JSON.parse(listed.output));
  if (sim === undefined) {
    process.stdout.write(
      "FAIL ios: no available iPhone simulator; install an iOS runtime in Xcode\n",
    );
    return false;
  }
  return runStep({
    label: `ios-app on ${sim.name}`,
    argv: [
      "xcodebuild",
      "-quiet",
      "-project",
      "ios-app/BeeBox.xcodeproj",
      "-scheme",
      "BeeBox",
      "-configuration",
      "Debug",
      "-destination",
      `platform=iOS Simulator,id=${sim.udid}`,
      "test",
    ],
    cwd: ".",
  });
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.nothingToDo) {
    process.stdout.write(
      "apple-test: no changed path is Apple code; nothing to run\n",
    );
    return 0;
  }
  const dev = await run(["xcode-select", "-p"], REPO_ROOT);
  if (dev.code !== 0 || !isFullXcode(dev.output)) {
    process.stderr.write(
      `apple-test: full Xcode is not selected (xcode-select -p: ${dev.output.trim() || "unavailable"}).\n` +
        "Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer\n",
    );
    return 1;
  }
  let failed = false;
  for (const name of options.steps) {
    let ok: boolean;
    if (name === "shared") {
      ok = await runStep({
        label: "apple-shared swift test",
        argv: ["swift", "test", "--disable-swift-testing"],
        cwd: "apple-shared",
      });
    } else if (name === "mac") {
      // Idempotent: a fresh worktree has no Vendor/Sparkle.xcframework (gitignored).
      ok = await runStep({
        label: "mac-app fetch-sparkle",
        argv: ["scripts/fetch-sparkle.sh"],
        cwd: "mac-app",
      });
      if (ok) {
        ok = existsSync(join(REPO_ROOT, "mac-app/Tests"))
          ? await runStep({
              label: "mac-app swift test",
              argv: ["swift", "test", "--disable-swift-testing"],
              cwd: "mac-app",
            })
          : await runStep({
              label: "mac-app swift build",
              argv: ["swift", "build"],
              cwd: "mac-app",
            });
      }
    } else {
      ok = await iosStep();
    }
    failed ||= !ok;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`apple-test: ${error.detail}\n${USAGE}\n`);
    process.exitCode = 2;
  }
}
