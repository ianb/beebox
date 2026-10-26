/**
 * `bin/cross-model-run` — run one read-only cross-model reviewer in the
 * foreground and save its prompt, raw trace, and final answer under scratch.
 *
 *   bin/cross-model-run --engine codex|claude [--model <id>] [--effort high]
 *     [--prompt-file <path> | < prompt] [--out <path.md>] [--cwd <root>]
 *     [--timeout <minutes>]
 *
 * The judgment (what to send, how to adjudicate) lives in the cross-model
 * skill; this file owns only the mechanics the skill used to spell out:
 *
 * - Codex: `codex exec - -s read-only -C <root> -m <model>
 *   -c model_reasoning_effort="<effort>" -o <out>`. `-o` writes the last
 *   agent message, so there is no trace scraping or duplicate final block.
 * - Claude: `claude -p --tools Read,Grep,Glob --setting-sources user
 *   --no-session-persistence`. No Bash or Edit tool makes it read-only and
 *   prevents a recursive cross-model run; `--setting-sources user` keeps the
 *   project SessionEnd hook (which can remove a merged worktree) from loading.
 *   Stdout is the final message.
 *
 * The prompt always travels on stdin: a positional prompt with open stdin can
 * stall Codex, and Claude's variadic `--tools` swallows a positional prompt.
 * The child runs in its own process group so a timeout or a signal to this
 * wrapper takes the whole reviewer tree down instead of orphaning it.
 *
 * A Codex run with no `--model` uses Sol; with `--hard` it uses Astra when the
 * weekly quota has room (`bin/lib/quota-room.ts`). Every Codex run records its 7-day use before
 * and after in the review cost ledger; `bin/quota-room` reports both.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { readCodexQuotaNow } from "../workstreams-app/src/server/main/quota-collect.js";
import { gitOrNull } from "./lib/git.js";
import { appendReviewCost, ledgerPath, pickCodexReviewModel, SOL, weeklyWindow, type ReviewCostRow } from "./lib/quota-room.js";
import type { Quota } from "../workstreams-app/src/shared/documents.js";

type Engine = "codex" | "claude";

const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
const EFFORTS: Record<Engine, readonly string[]> = {
  codex: ["minimal", "low", "medium", "high", "xhigh"],
  claude: ["low", "medium", "high", "xhigh", "max"],
};
const DEFAULT_TIMEOUT_MINUTES = 30;
const KILL_GRACE_MS = 10_000;
const TAIL_LINES = 20;

const USAGE = `usage: bin/cross-model-run --engine codex|claude [--model <id> | --hard] [--effort <level>]
       [--prompt-file <path>] [--out <path.md>] [--cwd <root>] [--timeout <minutes>]
The prompt is read from --prompt-file, or stdin when that is omitted.
Defaults: model ${SOL} (codex; --hard picks Astra when bin/quota-room shows room) / ${CLAUDE_DEFAULT_MODEL} (claude); effort high;
out scratch/cross-model/<timestamp>-<engine>.md; cwd the git root; timeout ${DEFAULT_TIMEOUT_MINUTES} min.
`;

interface RunOptions {
  engine: Engine;
  /** Undefined: Claude takes its default; Codex uses Sol, or picks from the quota room when hard. */
  model: string | undefined;
  hard: boolean;
  effort: string;
  prompt: string;
  out: string;
  cwd: string;
  timeoutMs: number;
}

function fail(message: string, code: number): never {
  process.stderr.write(`cross-model-run: ${message}\n`);
  process.exit(code);
}

/** Bad invocation: exit 2 with usage. */
function usageFail(message: string): never {
  fail(`${message}\n${USAGE}`, 2);
}

function gitRoot(from: string): string {
  const root = gitOrNull(["rev-parse", "--show-toplevel"], { cwd: from });
  if (root === null) usageFail(`not inside a git checkout: ${from}`);
  return root.trim();
}

function parseEngine(value: string | undefined): Engine {
  if (value === "codex" || value === "claude") return value;
  usageFail(`--engine must be codex or claude (got ${value ?? "nothing"})`);
}

function readPrompt(file: string | undefined): string {
  if (file !== undefined) return fs.readFileSync(file, "utf8");
  if (process.stdin.isTTY) usageFail("no prompt: pass --prompt-file or pipe the prompt on stdin");
  return fs.readFileSync(0, "utf8");
}

const CLI_OPTIONS = {
  engine: { type: "string" },
  model: { type: "string" },
  effort: { type: "string", default: "high" },
  "prompt-file": { type: "string" },
  out: { type: "string" },
  cwd: { type: "string" },
  timeout: { type: "string", default: String(DEFAULT_TIMEOUT_MINUTES) },
  hard: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
} as const;

function parseCli(argv: string[]): ReturnType<typeof parseArgs<{ args: string[]; options: typeof CLI_OPTIONS }>> {
  try {
    return parseArgs({ args: argv, options: CLI_OPTIONS });
  } catch (error) {
    if (error instanceof TypeError) usageFail(error.message);
    throw error;
  }
}

function parseOptions(argv: string[]): RunOptions {
  const { values } = parseCli(argv);
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const engine = parseEngine(values.engine);
  if (!EFFORTS[engine].includes(values.effort)) {
    usageFail(`--effort for ${engine} must be one of ${EFFORTS[engine].join(", ")}`);
  }
  const minutes = Number(values.timeout);
  if (!Number.isFinite(minutes) || minutes <= 0) usageFail("--timeout must be a positive number of minutes");
  const cwd = path.resolve(values.cwd ?? gitRoot(process.cwd()));
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) usageFail(`--cwd is not a directory: ${cwd}`);
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const out = path.resolve(values.out ?? path.join(gitRoot(process.cwd()), "scratch", "cross-model", `${stamp}-${engine}.md`));
  const prompt = readPrompt(values["prompt-file"]);
  if (prompt.trim() === "") usageFail("the prompt is empty");
  return {
    engine,
    model: values.model,
    hard: values.hard,
    effort: values.effort,
    prompt,
    out,
    cwd,
    timeoutMs: minutes * 60_000,
  };
}

function engineArgs(opts: RunOptions & { model: string }): string[] {
  if (opts.engine === "codex") {
    return [
      "exec", "-", "-s", "read-only", "-C", opts.cwd, "-m", opts.model,
      "-c", `model_reasoning_effort="${opts.effort}"`, "--color", "never", "-o", opts.out,
    ];
  }
  return [
    "-p", "--model", opts.model, "--effort", opts.effort, "--setting-sources", "user",
    "--no-session-persistence", "--tools", "Read,Grep,Glob", "--output-format", "text",
  ];
}

function requireEngine(engine: Engine): void {
  const probe = spawnSync(engine, ["--version"], { encoding: "utf8" });
  if (probe.error) {
    const hint = engine === "codex" ? "install with `npm install -g @openai/codex`, then `codex login`" : "install Claude Code and log in";
    fail(`${engine} is not runnable (${probe.error.message}); ${hint}`, 127);
  }
}

function tail(file: string): string {
  const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
  return lines.slice(-TAIL_LINES).join("\n");
}

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
}

/** Run the engine in its own process group, logging stdout+stderr to `logPath`. */
async function runEngine(opts: RunOptions & { model: string }, logPath: string): Promise<ChildResult> {
  const log = fs.createWriteStream(logPath);
  const child = spawn(opts.engine, engineArgs(opts), {
    cwd: opts.cwd,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    log.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => log.write(chunk));
  child.stdin.end(opts.prompt);

  const killGroup = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      // ESRCH: the group is already gone.
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  let timedOut = false;
  let forced: NodeJS.Timeout | undefined;
  const stopGroup = (): void => {
    killGroup("SIGTERM");
    forced = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stopGroup();
  }, opts.timeoutMs);
  // Interrupted: stop the group with the same TERM-then-KILL escalation as a
  // timeout, and exit once the child is gone.
  let interrupted: NodeJS.Signals | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interrupted !== undefined) {
      // Another interrupt kills the group at once.
      killGroup("SIGKILL");
      process.exit(128 + (signal === "SIGINT" ? 2 : 15));
    }
    interrupted = signal;
    clearTimeout(timer);
    stopGroup();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (c, s) => resolve([c, s]));
  });
  clearTimeout(timer);
  clearTimeout(forced);
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  // The direct child closing does not mean its descendants did; a stopped run
  // takes the rest of its group with it.
  if (timedOut || interrupted !== undefined) killGroup("SIGKILL");
  if (interrupted !== undefined) process.exit(128 + (interrupted === "SIGINT" ? 2 : 15));
  await new Promise<void>((resolve) => log.end(resolve));
  return { code, signal, timedOut, stdout };
}

function weeklyOf(quota: Quota): Quota["windows"][number] | null {
  return quota.status === "available" ? weeklyWindow(quota) : null;
}

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  requireEngine(parsed.engine);
  const before = parsed.engine === "codex" ? await readCodexQuotaNow() : null;
  let model = parsed.model ?? CLAUDE_DEFAULT_MODEL;
  if (parsed.model === undefined && before !== null) {
    const pick = parsed.hard ? pickCodexReviewModel(before, new Date()) : { model: SOL, reason: "routine review (no --hard)" };
    model = pick.model;
    process.stderr.write(`cross-model-run: picked ${pick.model}: ${pick.reason}\n`);
  }
  const opts = { ...parsed, model };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const base = opts.out.replace(/\.md$/, "");
  const promptPath = `${base}.prompt.md`;
  const logPath = `${base}.log`;
  fs.writeFileSync(promptPath, opts.prompt);
  fs.rmSync(opts.out, { force: true });

  const started = Date.now();
  const result = await runEngine(opts, logPath);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (before !== null) {
    // Codex writes its answer to opts.out; an empty one is a failure.
    const answered = result.code === 0 && fs.existsSync(opts.out) && fs.readFileSync(opts.out, "utf8").trim() !== "";
    const outcome = result.timedOut ? "timed-out" : answered ? "answered" : "failed";
    await recordCost(before, { model: opts.model, effort: opts.effort, outcome, seconds });
  }
  if (result.timedOut) {
    fail(`${opts.engine} timed out after ${opts.timeoutMs / 60_000} min; raw output: ${logPath}\n${tail(logPath)}`, 124);
  }
  if (result.code !== 0) {
    const how = result.signal === null ? `exit ${String(result.code)}` : `signal ${result.signal}`;
    fail(`${opts.engine} failed (${how}) after ${seconds}s; raw output: ${logPath}\n${tail(logPath)}`, 1);
  }
  if (opts.engine === "claude") fs.writeFileSync(opts.out, result.stdout);
  const answer = fs.existsSync(opts.out) ? fs.readFileSync(opts.out, "utf8").trim() : "";
  if (answer === "") fail(`${opts.engine} exited 0 but returned no final message; raw output: ${logPath}`, 1);

  process.stdout.write(
    `cross-model-run: ${opts.engine} ${opts.model} effort=${opts.effort} ${seconds}s\n` +
      `answer: ${opts.out}\nprompt: ${promptPath}\nraw: ${logPath}\n\n${answer}\n`,
  );
}

/** One ledger row per Codex review; skipped, with a note, when either read has no weekly window. */
async function recordCost(before: Quota, run: Pick<ReviewCostRow, "model" | "effort" | "outcome" | "seconds">): Promise<void> {
  const first = weeklyOf(before);
  const second = weeklyOf(await readCodexQuotaNow());
  if (first === null || second === null) {
    process.stderr.write("cross-model-run: no Codex 7-day reading; review cost not recorded\n");
    return;
  }
  appendReviewCost(ledgerPath(), {
    at: new Date().toISOString(), ...run,
    usedBefore: first.usedPercent, usedAfter: second.usedPercent,
    resetsBefore: first.resetsAt, resetsAfter: second.resetsAt,
  });
}

await main();
