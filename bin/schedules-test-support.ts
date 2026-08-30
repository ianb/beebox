/**
 * Shared fixtures for the `bin/schedules*.test.ts` files.
 *
 * Split out of `bin/schedules.test.ts` as a pure move when that file outgrew
 * the 300-line limit. Not itself a test file (no `*.test.ts` name), so the
 * root `pnpm test` glob does not pick it up; every consumer registers its own
 * `after(cleanupTempDirs)`.
 *
 * Real subprocesses and a real temp store: what is being tested is a script
 * being executed with an environment and a lock, which a fake would not
 * exercise. The clock, the PID-liveness probe, and the notifier are injected.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

import { loadSchedules, type LoadedSchedule, type ScheduleConfig } from "./lib/schedules.js";
import type { RunnerDeps } from "./lib/schedules-alerts.js";
import { errnoCode } from "../beebox/src/lib/error-guards.js";

const tempDirs: string[] = [];

export async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Every consumer registers this with `after()`; the list is per test process. */
export async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
}

/** Where the REAL session-registry.sh writes during these tests: the launch
 *  lease is part of what is under test, so the shell library runs for real
 *  against a temp state dir rather than being stood in for. */
export async function useTempRegistryStateDir(): Promise<void> {
  process.env["BBX_STATE_DIR"] = await tempDir("schedules-registry");
}

/**
 * Line-anchored matching without building a regex out of runtime text (a path,
 * a run id): `hasLines(text, ["a", "b"])` is `/^a\nb$/m` with nothing in the
 * needle reinterpreted as regex syntax.
 */
export function hasLines(text: string, lines: string[]): boolean {
  const all = text.split("\n");
  return all.some((_line, start) => lines.every((needle, offset) => all[start + offset] === needle));
}

/**
 * JSON a schedule (or a child process) wrote. The store is the parse boundary
 * and the caller names the shape it is about to assert on — a mismatch surfaces
 * as the failing assertion, which is what the test is for.
 */
export function shellJson<T>(text: string): T {
  const value: T = JSON.parse(text);
  return value;
}

export const REPO = path.dirname(import.meta.dirname);
export const REAL_PATH = process.env["PATH"] ?? "";
export const CLI = path.resolve(import.meta.dirname, "schedules.ts");

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export interface FixtureOptions {
  yaml: string;
  /** Body of the `run` script; omitted means no `run` file at all. */
  run?: string;
  runMode?: number;
  local?: string;
  prompt?: string;
}

/** One `schedules/<name>/` directory inside a fresh schedules root. */
export async function makeSchedule(name: string, options: FixtureOptions): Promise<{ schedulesRoot: string; dir: string }> {
  const schedulesRoot = await tempDir("schedules-src");
  const dir = path.join(schedulesRoot, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "schedule.yaml"), options.yaml, "utf8");
  if (options.run !== undefined) {
    const script = path.join(dir, "run");
    await fs.writeFile(script, options.run, "utf8");
    await fs.chmod(script, options.runMode ?? 0o755);
  }
  if (options.local !== undefined) await fs.writeFile(path.join(dir, "local.yaml"), options.local, "utf8");
  if (options.prompt !== undefined) await fs.writeFile(path.join(dir, "prompt.md"), options.prompt, "utf8");
  return { schedulesRoot, dir };
}

export const BASE_YAML = 'description: "A test schedule"\ncadence: 1d\n';

export interface Fake {
  deps: RunnerDeps;
  notifications: { title: string; message: string }[];
  setNow: (ms: number) => void;
}

export async function makeDeps(input: { schedulesRoot: string; nowMs: number; alive?: (pid: number) => boolean; mainRoot?: string; bootTimeMs?: number }): Promise<Fake> {
  const storeRoot = path.join(await tempDir("schedule-runs"), "store");
  const notifications: { title: string; message: string }[] = [];
  let nowMs = input.nowMs;
  return {
    notifications,
    setNow: (ms) => { nowMs = ms; },
    deps: {
      storeRoot,
      schedulesRoot: input.schedulesRoot,
      repoRoot: input.schedulesRoot,
      mainRoot: input.mainRoot ?? input.schedulesRoot,
      now: () => new Date(nowMs),
      pid: process.pid,
      isProcessAlive: input.alive ?? (() => true),
      bootTimeMs: () => input.bootTimeMs ?? null,
      notify: async (notification) => { notifications.push(notification); await Promise.resolve(); },
    },
  };
}

export function config(overrides: Partial<ScheduleConfig>): ScheduleConfig {
  return {
    description: "test",
    cadenceMs: DAY,
    graceMs: 6 * HOUR,
    enabled: true,
    timeoutMs: 2 * HOUR,
    workstream: null,
    ...overrides,
  };
}

export function stateAt(lastRunAt: string | null): { lastRunAt: string | null; lastRunId: string | null; lastExit: number | null; lastOutcome: null; sessionId: null } {
  return { lastRunAt, lastRunId: null, lastExit: null, lastOutcome: null, sessionId: null };
}

export async function onlySchedule(schedulesRoot: string): Promise<LoadedSchedule> {
  const entries = await loadSchedules(schedulesRoot);
  const [entry] = entries;
  assert.ok(entry !== undefined && entry.kind === "ok", `expected one valid schedule, got ${JSON.stringify(entries)}`);
  return entry;
}

export interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(args: string[], options: { env: NodeJS.ProcessEnv; input?: string }): Promise<CliRun> {
  const result = await execa("node", ["--import", "tsx", CLI, ...args], {
    reject: false,
    env: { ...process.env, SCHEDULE_NOTIFY: "0", ...options.env },
    cwd: path.dirname(path.dirname(CLI)),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr };
}

export const HANDOFF_RUN = [
  "#!/bin/sh",
  'printf \'{"runId":"%s","title":"twelve exports","body":"remove them","at":"2026-08-24T12:00:00.000Z"}\\n\' "$SCHEDULE_RUN_ID" \\',
  '  > "$SCHEDULE_STATE_DIR/runs/$SCHEDULE_RUN_ID.handoff.json"',
  "",
].join("\n");

export function workstreamYaml(fields: string): string {
  return [
    'description: "a schedule with an agent"',
    "cadence: 1d",
    "workstream:",
    "  agent: claude",
    "  model: opus",
    "  session: fresh",
    "  permissionMode: bypassPermissions",
    fields,
    "",
  ].join("\n");
}

export interface Rig {
  fake: Fake;
  schedule: LoadedSchedule;
  worktreePath: string;
  binDir: string;
  /** Everything the fake agent saw: argv, cwd, environment, briefing. */
  transcript: () => Promise<string>;
}

/**
 * A schedule whose agent is a shell script that records what it was given.
 * Nothing here launches a real agent — but `bin/workstreams` is only stood in
 * for because creating a real worktree costs ten seconds and a git mutation;
 * the registry, the store, the launch-headless assembly, and the process
 * plumbing are all the shipping ones.
 */
export async function launchRig(input: {
  name: string;
  yaml: string;
  run: string;
  liveness: string;
  agentExit: number;
  agentExtra: string;
  check: string | null;
}): Promise<Rig> {
  const { schedulesRoot, dir } = await makeSchedule(input.name, {
    yaml: input.yaml,
    run: input.run,
    prompt: "You are the test agent. Finish with bin/schedules alert or done.\n",
  });
  if (input.check !== null) {
    const check = path.join(dir, "check");
    await fs.writeFile(check, input.check, "utf8");
    await fs.chmod(check, 0o755);
  }

  const mainRoot = await tempDir("main-checkout");
  const worktreePath = path.join(await tempDir("worktrees"), input.name);
  await fs.mkdir(path.join(mainRoot, "bin"), { recursive: true });
  const workstreams = path.join(mainRoot, "bin", "workstreams");
  await fs.writeFile(workstreams, [
    "#!/bin/sh",
    "case \"$1\" in",
    // A real worktree is a git worktree, and the runner brings it up to date
    // with `main` before launching. Make the fake one an actual repo on `main`
    // so that merge is exercised rather than sidestepped.
    `  create) mkdir -p "${worktreePath}";`,
    `    if [ ! -e "${worktreePath}/.git" ]; then`,
    `      git -C "${worktreePath}" init -q -b main;`,
    `      git -C "${worktreePath}" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init;`,
    "    fi;",
    `    printf '%s\\n' "${worktreePath}" ;;`,
    `  agent-liveness) printf '{"ok":true,"paths":{"%s":{"state":"${input.liveness}","reason":"fake"}}}\\n' "$2" ;;`,
    "  *) echo \"unexpected: $*\" >&2; exit 64 ;;",
    "esac",
    "",
  ].join("\n"), "utf8");
  await fs.chmod(workstreams, 0o755);

  const binDir = await tempDir("fake-agent-bin");
  const agentLog = path.join(binDir, "transcript.txt");
  const script = [
    "#!/bin/sh",
    "{",
    "  printf 'cwd=%s\\n' \"$PWD\"",
    "  printf 'name=%s\\n' \"$SCHEDULE_NAME\"",
    "  printf 'runid=%s\\n' \"$SCHEDULE_RUN_ID\"",
    "  printf 'statedir=%s\\n' \"$SCHEDULE_STATE_DIR\"",
    "  for a in \"$@\"; do printf 'arg=%s\\n' \"$a\"; done",
    "  printf 'briefing<<\\n'",
    "  cat",
    `} > "${agentLog}"`,
    input.agentExtra,
    `exit ${String(input.agentExit)}`,
    "",
  ].join("\n");
  for (const name of ["claude", "codex"]) {
    const file = path.join(binDir, name);
    await fs.writeFile(file, script, "utf8");
    await fs.chmod(file, 0o755);
  }

  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z"), mainRoot });
  return {
    fake,
    schedule: await onlySchedule(schedulesRoot),
    worktreePath,
    binDir,
    transcript: async () => {
      try {
        return await fs.readFile(agentLog, "utf8");
      } catch (e) {
        if (errnoCode(e) === "ENOENT") return "";
        throw e;
      }
    },
  };
}

/** The fake agent is found the way the real one is: by name, on PATH. */
export async function withFakeAgent<T>(rig: Rig, body: () => Promise<T>): Promise<T> {
  process.env["PATH"] = `${rig.binDir}:${REAL_PATH}`;
  try {
    return await body();
  } finally {
    process.env["PATH"] = REAL_PATH;
  }
}

export const REPORTS_DONE = [
  'printf \'{"runId":"%s","kind":"done","alertId":null,"at":"2026-08-24T12:00:00.000Z"}\\n\' "$SCHEDULE_RUN_ID" \\',
  '  > "$SCHEDULE_STATE_DIR/runs/$SCHEDULE_RUN_ID.result.json"',
].join("\n");

