/**
 * `dispatch <dir|file>... --model luna|haiku`: one worker makes a batch of
 * converted files pass lint and typecheck (plan retire-doctest.md, track 3,
 * "phase 2 worker task").
 *
 * The worker runs in a slot: a dedicated git worktree with node_modules
 * installed, reset to this checkout's HEAD before each batch, with the
 * batch's files and the state files copied in from this working tree
 * (unverified conversions cannot be committed: pre-commit lints them).
 * Afterward the driver rejects the batch if the worker ran a forbidden
 * command or changed anything but the batch, then copies the batch's files
 * back and verifies them in this checkout, which records the result.
 * Applying is serial: one dispatch at a time holds the apply lock.
 */

import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { NothingToDispatchError, SlotBusyError, ToolOutputError } from "./errors.ts";
import { REPO } from "./tools.ts";
import { select, verify, type Selected } from "./verify.ts";
import { loadAll, STATE_DIR, writeProgress } from "./state.ts";

export const SLOT_COUNT = 4;
const WORKER_TIMEOUT_MS = 30 * 60 * 1000;

/** Commands a worker must not run (the brief forbids them). */
const RULE_BREAKS: readonly RegExp[] = [
  /\bpnpm (?:install|i|add|remove)\b/,
  /\b(?:kill|killall|pkill)\b/,
  /\bgit (?:push|reset|checkout|stash|clean|commit|restore|switch|rebase|merge)\b/,
  /--no-verify/,
  /\brm\b/,
];

export type Model = "luna" | "haiku";

export function slotsDir(): string {
  return process.env.DOCTEST_CONVERT_SLOTS ?? join(tmpdir(), "doctest-convert-slots");
}

function git(cwd: string, args: readonly string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new ToolOutputError({ what: ["git", ...args.slice(0, 2)], output: r.stderr });
  return r.stdout;
}

/** Create the slots that do not exist yet, each with node_modules installed. */
export function initSlots(log: (s: string) => void): void {
  mkdirSync(slotsDir(), { recursive: true });
  const head = git(REPO, ["rev-parse", "HEAD"]).trim();
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const slot = join(slotsDir(), `slot-${n}`);
    if (existsSync(slot)) continue;
    log(`creating ${slot}`);
    git(REPO, ["worktree", "add", "--detach", slot, head]);
    install(slot);
  }
}

function install(slot: string): void {
  const r = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: slot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new ToolOutputError({ what: ["pnpm install in", slot], output: r.stdout + r.stderr });
}

/** Whether an error is the EEXIST of an exclusive create: the lock is held. */
function isHeld(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** Take a free slot: its lock file is created exclusively, and removed by `release`. */
function claimSlot(): { slot: string; release: () => void } {
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const slot = join(slotsDir(), `slot-${n}`);
    if (!existsSync(slot)) continue;
    const lock = `${slot}.lock`;
    try {
      closeSync(openSync(lock, "wx"));
    } catch (error) {
      if (isHeld(error)) continue;
      throw error;
    }
    writeFileSync(lock, `${process.pid}\n`);
    return { slot, release: () => rmSync(lock, { force: true }) };
  }
  throw new SlotBusyError(slotsDir());
}

/** Hold the apply lock while `fn` runs; waits for another dispatch to finish applying. */
function withApplyLock<T>(fn: () => T): T {
  const lock = join(slotsDir(), "apply.lock");
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if (!isHeld(error)) throw error;
      Atomics.wait(wait, 0, 0, 1000);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

export function brief(tests: readonly string[]): string {
  return [
    "A script converted doctests in this repository to these .test.ts files:",
    ...tests.map((t) => `- ${t}`),
    "",
    "Make them pass lint and typecheck. Edit only these files. Do not change any expected value (the last argument of",
    "t.check, t.checkText, or t.checkThrows) or any `// doctest:` comment. A checked expression may change only to",
    "satisfy lint, and must keep its value. You may rename variables, extract helpers within the file, add types, and",
    "remove unused code that lint flags. If a file is over the line limit, split a long test into smaller tests in the",
    "same file only when no marker or check moves to another file; otherwise leave the finding and say why.",
    "",
    "Check your work with this command, from the repository root, and run it before you finish:",
    `  node --import tsx bin/doctest-convert.ts check ${tests.join(" ")}`,
    "It reports each file's remaining problems; \"verified N of N\" means done.",
    "",
    "Do not run git, pnpm install, rm, kill, or pkill, and do not start subagents.",
  ].join("\n");
}

function workerCommand(model: Model, slot: string): { cmd: string; args: string[] } {
  if (model === "luna") return { cmd: "codex", args: ["exec", "-", "-s", "workspace-write", "-C", slot, "-m", "gpt-6-luna", "--json", "--color", "never"] };
  return {
    cmd: "claude",
    args: ["-p", "--model", "haiku", "--permission-mode", "acceptEdits", "--allowedTools", "Bash,Read,Edit,Glob,Grep", "--output-format", "stream-json", "--verbose", "--no-session-persistence"],
  };
}

/** Shell commands from either CLI's JSON events: every string under a `command` key. */
export function commandsIn(transcript: string): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) visit(x);
    else if (typeof v === "object" && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (k === "command" && typeof x === "string") out.push(x);
        else if (k === "command" && Array.isArray(x)) out.push(x.map(String).join(" "));
        else visit(x);
      }
    }
  };
  for (const line of transcript.split("\n")) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      // A CLI prints a few plain-text lines among its JSON events.
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    visit(event);
  }
  return out;
}

export interface DispatchResult {
  accepted: boolean;
  reasons: string[];
  transcript: string;
  selected: Selected[];
  /** For a trial: the slot's own `check` output. */
  checkOutput?: string;
}

function contentOf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Paths `git status` reports changed in a worktree. */
function changedPaths(cwd: string): string[] {
  return git(cwd, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.slice(3).replace(/^.* -> /, ""));
}

/**
 * With `trial`, the edits are checked in the slot and not applied: the
 * calibration run gives both models the same files.
 */
export function dispatch(batch: { paths: readonly string[]; model: Model; trial: boolean }, log: (s: string) => void): DispatchResult {
  const { paths, model } = batch;
  const selected = select(paths).filter((s) => s.file.status === "converted");
  const tests = selected.map((s) => s.file.test);
  if (tests.length === 0) throw new NothingToDispatchError(paths);
  const head = git(REPO, ["rev-parse", "HEAD"]).trim();
  const { slot, release } = claimSlot();
  try {
    log(`${slot}: ${tests.length} files, ${model}`);
    git(slot, ["checkout", "-qf", "--detach", head]);
    git(slot, ["clean", "-fdq"]);
    install(slot);
    for (const t of tests) {
      mkdirSync(dirname(join(slot, t)), { recursive: true });
      copyFileSync(join(REPO, t), join(slot, t));
    }
    const stateRel = relative(REPO, STATE_DIR);
    rmSync(join(slot, stateRel), { recursive: true, force: true });
    cpSync(STATE_DIR, join(slot, stateRel), { recursive: true });
    // What the slot holds before the worker starts; anything else it changes is outside the batch.
    const before = new Map(changedPaths(slot).map((p) => [p, contentOf(join(slot, p))]));
    const { cmd, args } = workerCommand(model, slot);
    const r = spawnSync(cmd, args, { cwd: slot, input: brief(tests), encoding: "utf8", timeout: WORKER_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });
    const transcript = r.stdout;
    const runs = join(slotsDir(), "runs");
    mkdirSync(runs, { recursive: true });
    const transcriptPath = join(runs, `${new Date().toISOString().replaceAll(":", "-")}-${model}.jsonl`);
    writeFileSync(transcriptPath, transcript);
    log(`transcript: ${transcriptPath}`);

    const reasons: string[] = [];
    if (r.error !== undefined) reasons.push(`worker did not finish: ${r.error.message}`);
    for (const c of commandsIn(transcript)) {
      if (RULE_BREAKS.some((re) => re.test(c))) reasons.push(`ran a forbidden command: ${c.slice(0, 200)}`);
    }
    for (const p of changedPaths(slot)) {
      if (tests.includes(p)) continue;
      if (before.has(p) && before.get(p) === contentOf(join(slot, p))) continue;
      reasons.push(`changed a path outside the batch: ${p}`);
    }
    if (reasons.length > 0) return { accepted: false, reasons, transcript: transcriptPath, selected };
    if (batch.trial) {
      const c = spawnSync("node", ["--import", "tsx", "bin/doctest-convert.ts", "check", ...tests], { cwd: slot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const passed = c.status === 0;
      if (!passed) reasons.push("not verified in the slot");
      return { accepted: passed, reasons, transcript: transcriptPath, selected, checkOutput: c.stdout + c.stderr };
    }

    withApplyLock(() => {
      for (const t of tests) copyFileSync(join(slot, t), join(REPO, t));
      // Reselect: another dispatch may have saved the state files meanwhile.
      const fresh = select(tests);
      verify(fresh, { save: true });
      writeProgress(loadAll());
      selected.splice(0, selected.length, ...fresh);
    });
    const failing = selected.filter((s) => s.file.problems.length > 0).map((s) => s.file.test);
    if (failing.length > 0) reasons.push(`not verified: ${failing.join(" ")}`);
    return { accepted: failing.length === 0, reasons, transcript: transcriptPath, selected };
  } finally {
    release();
  }
}

/** The worker's last message, for the report. */
export function lastWords(transcriptPath: string): string {
  const text = readFileSync(transcriptPath, "utf8");
  const lines = text.trim().split("\n");
  return (lines.at(-1) ?? "").slice(0, 2000);
}
