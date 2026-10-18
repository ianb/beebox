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
 * Applying is serial: it holds the checkout's state lock.
 *
 * Accepted gaps (the workers are cheap models following a brief, not
 * adversaries): a worker's background process can outlive the timeout, and
 * a `--trial` check runs the slot's own node_modules, which a worker could
 * edit. An applied batch is verified here, with this checkout's tools.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { BatchInUseError, NothingToDispatchError, SlotBusyError, ToolOutputError } from "./errors.ts";
import { isAlive, readLock, stateLockPath, tryLock, withLock } from "./locks.ts";
import { REPO } from "./tools.ts";
import { select, verify, type Selected } from "./verify.ts";
import { loadAll, STATE_DIR, writeProgress } from "./state.ts";

export const SLOT_COUNT = 4;
const WORKER_TIMEOUT_MS = 30 * 60 * 1000;

/** Commands a worker must not run (the brief forbids them). */
const RULE_BREAKS: readonly RegExp[] = [
  /\bpnpm (?:install|i|add|remove)\b/,
  /\b(?:kill|killall|pkill)\b/,
  /--no-verify/,
  /\brm\b/,
];
/**
 * git as a command word (not `.git` or `git-lock.test.ts`). It may only
 * read: every git command in a line must be one of these.
 */
const GIT = /(?:^|[\s&(;|])git\s/g;
const GIT_READ = /(?:^|[\s&(;|])git\s+(?:-C\s+\S+\s+)?(?:diff|status|log|show|ls-files|grep|blame)\b/g;

/** A heredoc's body: text fed to a command, not run by the shell. */
const HEREDOC = /<<-?\s*(["']?)(\w+)\1[^\n]*\n[\S\s]*?\n\s*\2(?=\n|$)/g;

export function forbidden(fullCommand: string): boolean {
  // An edit script's text names git or rm freely; only the shell part counts.
  const command = fullCommand.replaceAll(HEREDOC, "<<heredoc");
  if (RULE_BREAKS.some((re) => re.test(command))) return true;
  return [...command.matchAll(GIT)].length !== [...command.matchAll(GIT_READ)].length;
}

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

/**
 * Take a free slot and reserve the batch's files: no two dispatches work on
 * one file. The slot's lock file holds both.
 */
function claimSlot(tests: readonly string[]): { slot: string; release: () => void } {
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => join(slotsDir(), `slot-${i + 1}`)).filter((s) => existsSync(s));
  for (const slot of slots) {
    if (!tryLock(`${slot}.lock`, tests)) continue;
    // A reservation whose owner has exited holds nothing.
    const held = slots
      .filter((o) => o !== slot)
      .map((o) => readLock(`${o}.lock`))
      .flatMap((l) => (l !== null && isAlive(l.pid) ? l.files : []));
    const overlap = tests.filter((t) => held.includes(t));
    if (overlap.length > 0) {
      rmSync(`${slot}.lock`, { force: true });
      throw new BatchInUseError(overlap);
    }
    return { slot, release: () => rmSync(`${slot}.lock`, { force: true }) };
  }
  throw new SlotBusyError(slotsDir());
}

export function brief(tests: readonly string[]): string {
  return [
    "A script converted doctests in this repository to these .test.ts files:",
    ...tests.map((t) => `- ${t}`),
    "",
    "Make them pass lint and typecheck. Edit only these files. Do not change any expected value (the last argument of",
    "t.check, t.checkText, or t.checkThrows) or any `// doctest:` comment. A checked expression may change only to",
    "satisfy lint, and must keep its value. You may rename variables, extract helpers within the file, add types, and",
    "remove unused code that lint flags. Leave a max-lines finding (the file is too long): fixing it means a new file,",
    "which the driver handles; say that you left it.",
    "",
    "Check your work with this command, from the repository root, and run it before you finish:",
    `  node --import tsx bin/doctest-convert.ts check ${tests.join(" ")}`,
    "It reports each file's remaining problems; \"verified N of N\" means done.",
    "",
    "Do not add eslint-disable comments: fix the code, or leave the finding and say why.",
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

/**
 * Paths `git status` reports changed in a worktree, both ends of a rename
 * included. NUL-separated, so no path is quoted.
 */
export function parseStatus(z: string): string[] {
  const fields = z.split("\0").filter((f) => f !== "");
  const out: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] ?? "";
    out.push(entry.slice(3));
    // A rename or copy entry is followed by its source path.
    if (/^[CR]/.test(entry) || /^.[CR]/.test(entry)) out.push(fields[++i] ?? "");
  }
  return out;
}

function changedPaths(cwd: string): string[] {
  return parseStatus(git(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]));
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
  const { slot, release } = claimSlot(tests);
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
    else if (r.status !== 0) reasons.push(`worker exited with ${r.status ?? r.signal ?? "no status"}`);
    for (const c of commandsIn(transcript)) if (forbidden(c)) reasons.push(`ran a forbidden command: ${c.slice(0, 200)}`);
    if (git(slot, ["rev-parse", "HEAD"]).trim() !== head) reasons.push("moved the slot's HEAD");
    if (spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: slot }).status !== 0) reasons.push("staged changes");
    // Every path changed before or after the worker ran, against what it held before.
    for (const p of new Set([...before.keys(), ...changedPaths(slot)])) {
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

    withLock(stateLockPath(), () => {
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
