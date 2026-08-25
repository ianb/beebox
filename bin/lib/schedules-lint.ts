/**
 * `bin/schedules lint` — everything about a schedule that can be checked
 * without running it.
 *
 * A schedule fails at 03:00 on a Sunday with nobody watching, so the checks
 * have to happen at commit time (the pre-commit hook runs this whenever
 * anything under `schedules/` is staged) and again at the top of every tick.
 * On top of the loader's own parse errors this adds the three contracts a
 * schedule can only break at runtime: a script with no shebang, a `run` that
 * ignores `SCHEDULE_DRY_RUN`, and a `prompt.md` that never tells the agent to
 * report through `bin/schedules alert`. Shell scripts go to shellcheck, and
 * TypeScript scripts to eslint under the personal-vibe-check preset.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track E).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { z } from "zod";

import { ScheduleError, loadSchedules, type ScheduleEntry } from "./schedules.js";

/** One thing wrong with one file, rendered as `schedules/<name>/<file>: <message>`. */
export interface LintFinding {
  /** The schedule's directory name. */
  schedule: string;
  /** Path relative to `schedules/<name>/`. */
  file: string;
  message: string;
}

export interface LintInput {
  /** `<checkout>/schedules`. */
  schedulesRoot: string;
  /** The checkout shellcheck and eslint run in — eslint resolves the root
   *  flat config (and its `schedules/**` scope) from here. */
  repoRoot: string;
}

export function formatFinding(finding: LintFinding): string {
  return `schedules/${finding.schedule}/${finding.file}: ${finding.message}`;
}

// ─── Shebangs ─────────────────────────────────────────────────────────────

export type ScriptKind = "shell" | "node" | "other" | "none";

/**
 * What a script's first line says it is. `env` is skipped along with its
 * options, so `#!/usr/bin/env -S node --import tsx` reads as node the same way
 * `#!/bin/bash` reads as shell.
 */
export function shebangKind(text: string): ScriptKind {
  const [firstLine] = text.split("\n");
  if (firstLine === undefined || !firstLine.startsWith("#!")) return "none";
  const words = firstLine.slice(2).trim().split(/\s+/).filter((word) => word !== "");
  const interpreters: string[] = [];
  for (const word of words) {
    if (word.startsWith("-")) continue;
    const base = path.basename(word);
    if (base === "env") continue;
    interpreters.push(base);
    break;
  }
  const [interpreter] = interpreters;
  if (interpreter === undefined) return "none";
  if (interpreter === "sh" || interpreter === "bash" || interpreter === "zsh" || interpreter === "dash") return "shell";
  if (interpreter === "node" || interpreter === "tsx") return "node";
  return "other";
}

// ─── Reading a schedule directory ─────────────────────────────────────────

/** The two script names a schedule can hold, in report order. */
const SCRIPT_NAMES = ["run", "check"];

interface ScriptFile {
  schedule: string;
  /** Path relative to the schedule directory (what a finding names). */
  file: string;
  absolute: string;
  kind: ScriptKind;
  text: string;
}

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/** Every `.ts` file under a schedule directory, relative-pathed. */
async function typescriptFiles(dir: string): Promise<string[]> {
  let entries: { name: string; parentPath: string; isFile: () => boolean }[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * The loader's issues, one finding each. A Zod issue's path is
 * `schedule.yaml: cadence`, so the file and the field are split back apart —
 * a finding names one file, and the field belongs in the message.
 */
function loaderFindings(entry: ScheduleEntry): LintFinding[] {
  if (entry.kind === "ok") return [];
  return entry.issues.map((issue) => {
    const separator = issue.path.indexOf(": ");
    if (separator === -1) return { schedule: entry.name, file: issue.path, message: issue.message };
    return {
      schedule: entry.name,
      file: issue.path.slice(0, separator),
      message: `${issue.path.slice(separator + 2)}: ${issue.message}`,
    };
  });
}

// ─── The external linters ─────────────────────────────────────────────────

/** A linter that printed something other than the JSON it was asked for is a
 *  broken toolchain, not a clean schedule — so it raises rather than reading as
 *  "no findings". */
function parseJson(input: { tool: string; text: string }): unknown {
  try {
    return JSON.parse(input.text);
  } catch (e) {
    throw new ScheduleError(`${input.tool} did not print JSON (${e instanceof Error ? e.message : String(e)}): ${input.text.slice(0, 200)}`);
  }
}

// ─── shellcheck ───────────────────────────────────────────────────────────

const shellcheckSchema = z.object({
  comments: z.array(
    z.object({
      file: z.string(),
      line: z.number(),
      level: z.string(),
      code: z.number(),
      message: z.string(),
    }),
  ),
});

/** The shellcheck binary the npm wrapper fetches. The wrapper's default is
 *  `latest` — a GitHub lookup whose answer changes under us — so the release is
 *  pinned here the way the wrapper itself is pinned in the lockfile. It
 *  downloads once per `node_modules` (lazily, on the first lint), and its
 *  progress chatter goes to **stdout**, which would land in the middle of the
 *  JSON below; `error` is the quietest level that still reports a failure. */
const SHELLCHECK_ENV = { SHELLCHECKJS_RELEASE: "v0.11.0", SHELLCHECKJS_LOGGER_LEVEL: "error" };

/**
 * One shellcheck run over every shell script in every schedule — pinned in the
 * root `devDependencies` and invoked through `pnpm exec`, so the version is the
 * lockfile's rather than whatever the laptop happens to have installed.
 */
async function shellcheckFindings(input: { repoRoot: string; scripts: ScriptFile[] }): Promise<LintFinding[]> {
  if (input.scripts.length === 0) return [];
  const byPath = new Map(input.scripts.map((script) => [script.absolute, script]));
  const result = await execa("pnpm", ["exec", "shellcheck", "--format=json1", "--", ...byPath.keys()], {
    cwd: input.repoRoot,
    reject: false,
    env: SHELLCHECK_ENV,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new ScheduleError(`shellcheck failed (exit ${String(result.exitCode)}): ${result.stderr || result.stdout}`);
  }
  const parsed = shellcheckSchema.safeParse(parseJson({ tool: "shellcheck", text: result.stdout }));
  if (!parsed.success) throw new ScheduleError(`shellcheck output was not the expected JSON: ${result.stdout.slice(0, 200)}`);
  const findings: LintFinding[] = [];
  for (const comment of parsed.data.comments) {
    const script = byPath.get(path.resolve(input.repoRoot, comment.file));
    if (script === undefined) continue;
    findings.push({
      schedule: script.schedule,
      file: script.file,
      message: `line ${String(comment.line)}: SC${String(comment.code)} (${comment.level}) ${comment.message}`,
    });
  }
  return findings;
}

// ─── eslint ───────────────────────────────────────────────────────────────

const eslintSchema = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        line: z.number().nullable(),
        ruleId: z.string().nullable(),
        message: z.string(),
      }),
    ),
  }),
);

/** eslint startup in this repo costs seconds regardless of how much it lints,
 *  so a schedule's TypeScript goes through as few invocations as possible: one
 *  for every real file under `<repo>/schedules/`, plus a parallel stdin run per
 *  script eslint cannot be handed by path. */
async function runEslint(input: { repoRoot: string; args: string[]; stdin: string | null }): Promise<Map<string, { line: number | null; ruleId: string | null; message: string }[]>> {
  const result = await execa("pnpm", ["exec", "eslint", "--format", "json", ...input.args], {
    cwd: input.repoRoot,
    reject: false,
    ...(input.stdin === null ? {} : { input: input.stdin }),
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new ScheduleError(`eslint failed (exit ${String(result.exitCode)}): ${result.stderr || result.stdout}`);
  }
  const parsed = eslintSchema.safeParse(parseJson({ tool: "eslint", text: result.stdout }));
  if (!parsed.success) throw new ScheduleError(`eslint output was not the expected JSON: ${result.stdout.slice(0, 200)}`);
  const byFile = new Map<string, { line: number | null; ruleId: string | null; message: string }[]>();
  for (const file of parsed.data) {
    for (const message of file.messages) {
      // "File ignored…" is eslint reporting that the root flat config does not
      // cover schedules/ any more. Left as a warning it would read as a clean
      // schedule, which is the one wrong answer this command can give.
      if (message.ruleId === null && message.message.startsWith("File ignored")) {
        throw new ScheduleError(`eslint does not lint ${file.filePath} — the root eslint.config.mjs no longer scopes schedules/**/*.ts (${message.message})`);
      }
    }
    byFile.set(file.filePath, file.messages);
  }
  return byFile;
}

function eslintFinding(input: { script: ScriptFile; message: { line: number | null; ruleId: string | null; message: string } }): LintFinding {
  const { message } = input;
  return {
    schedule: input.script.schedule,
    file: input.script.file,
    message: `line ${String(message.line ?? 0)}: ${message.message}${message.ruleId === null ? "" : ` (${message.ruleId})`}`,
  };
}

/**
 * Every TypeScript script, linted under the personal-vibe-check preset the root
 * `eslint.config.mjs` scopes to `schedules/**\/*.ts`.
 *
 * A script eslint cannot be handed by path — an executable `run` with a node
 * shebang has no `.ts` extension, and a test fixture lives outside the repo —
 * goes in on stdin under a virtual filename inside `<repo>/schedules/`, which
 * is what the config's scope matches on.
 */
async function eslintFindings(input: { repoRoot: string; scripts: ScriptFile[] }): Promise<LintFinding[]> {
  if (input.scripts.length === 0) return [];
  const schedulesPrefix = `${path.join(input.repoRoot, "schedules")}${path.sep}`;
  const byPath = input.scripts.filter((script) => script.file.endsWith(".ts") && script.absolute.startsWith(schedulesPrefix));
  const byStdin = input.scripts.filter((script) => !byPath.includes(script));

  const runs = byStdin.map(async (script) => {
    const virtualName = script.file.endsWith(".ts") ? script.file : `${script.file}.ts`;
    const virtualPath = path.join(input.repoRoot, "schedules", script.schedule, virtualName);
    const messages = await runEslint({
      repoRoot: input.repoRoot,
      args: ["--stdin", "--stdin-filename", virtualPath],
      stdin: script.text,
    });
    return (messages.get(virtualPath) ?? []).map((message) => eslintFinding({ script, message }));
  });
  if (byPath.length > 0) {
    runs.push(
      (async () => {
        const messages = await runEslint({ repoRoot: input.repoRoot, args: ["--", ...byPath.map((script) => script.absolute)], stdin: null });
        return byPath.flatMap((script) => (messages.get(script.absolute) ?? []).map((message) => eslintFinding({ script, message })));
      })(),
    );
  }
  return (await Promise.all(runs)).flat();
}

// ─── The command ──────────────────────────────────────────────────────────

const DRY_RUN_VARIABLE = "SCHEDULE_DRY_RUN";
const ALERT_COMMAND = "bin/schedules alert";

async function readScripts(input: { name: string; dir: string }): Promise<ScriptFile[]> {
  const scripts: ScriptFile[] = [];
  for (const name of SCRIPT_NAMES) {
    const absolute = path.join(input.dir, name);
    const text = await readIfPresent(absolute);
    if (text === null) continue;
    scripts.push({ schedule: input.name, file: name, absolute, kind: shebangKind(text), text });
  }
  for (const relative of await typescriptFiles(input.dir)) {
    const absolute = path.join(input.dir, relative);
    const text = await readIfPresent(absolute);
    if (text === null) continue;
    scripts.push({ schedule: input.name, file: relative, absolute, kind: "node", text });
  }
  return scripts;
}

function orderFindings(findings: LintFinding[]): LintFinding[] {
  return [...findings].sort((left, right) => {
    if (left.schedule !== right.schedule) return left.schedule < right.schedule ? -1 : 1;
    if (left.file !== right.file) return left.file < right.file ? -1 : 1;
    return left.message < right.message ? -1 : left.message === right.message ? 0 : 1;
  });
}

/**
 * Every finding across every `schedules/<name>/`. The loader's issues do not
 * stop the file checks: an author fixing a schedule wants the whole list, not
 * the first complaint.
 */
export async function lintSchedules(input: LintInput): Promise<LintFinding[]> {
  const entries = await loadSchedules(input.schedulesRoot);
  const findings: LintFinding[] = [];
  const shellScripts: ScriptFile[] = [];
  const nodeScripts: ScriptFile[] = [];

  for (const entry of entries) {
    findings.push(...loaderFindings(entry));
    const scripts = await readScripts({ name: entry.name, dir: entry.dir });

    for (const script of scripts) {
      if (!SCRIPT_NAMES.includes(script.file)) continue;
      if (script.kind === "none") {
        findings.push({ schedule: entry.name, file: script.file, message: "needs a shebang (#!/usr/bin/env bash or #!/usr/bin/env -S node --import tsx)" });
      }
      // The loader already refuses a `run` that is not executable; `check` is
      // optional, so a present-but-unexecutable one is this command's to catch.
      if (script.file === "check" && !(await isExecutable(script.absolute))) {
        findings.push({ schedule: entry.name, file: "check", message: "is not executable" });
      }
      if (script.kind === "shell") shellScripts.push(script);
      if (script.kind === "node") nodeScripts.push(script);
    }
    for (const script of scripts) {
      if (SCRIPT_NAMES.includes(script.file)) continue;
      nodeScripts.push(script);
    }

    // Attributed to `run` but satisfied by any script in the directory: a `run`
    // that is a two-line shim to `run.ts` honors the dry-run contract in the
    // file that does the work, and flagging the shim would be a false positive.
    const run = scripts.find((script) => script.file === "run");
    if (run !== undefined && !scripts.some((script) => script.text.includes(DRY_RUN_VARIABLE))) {
      findings.push({ schedule: entry.name, file: "run", message: `never mentions ${DRY_RUN_VARIABLE} — a run script must honor the dry-run contract` });
    }

    const prompt = await readIfPresent(path.join(entry.dir, "prompt.md"));
    if (prompt !== null && !prompt.includes(ALERT_COMMAND)) {
      findings.push({ schedule: entry.name, file: "prompt.md", message: `never mentions \`${ALERT_COMMAND}\` — a session with no report is a bailed run` });
    }
  }

  findings.push(...(await shellcheckFindings({ repoRoot: input.repoRoot, scripts: shellScripts })));
  findings.push(...(await eslintFindings({ repoRoot: input.repoRoot, scripts: nodeScripts })));
  return orderFindings(findings);
}
