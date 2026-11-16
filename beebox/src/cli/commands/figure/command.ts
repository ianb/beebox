/**
 * `bbx figure`: commands for figure cards. `run` renders canvas-loop figures
 * headlessly (see run.ts); `run-one` is its internal child.
 */
import { Command } from "commander";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { checkSharedCode, FigureRunError, listCanvasLoopFigures, prepareFigureJob, runFigureJob, type FigureRunResult, type SharedTypeErrors } from "./run.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/** A positive whole number from `--<flag>`, or an error naming the flag. */
function count(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new FigureRunError({ detail: `--${flag} takes a whole number of at least 1 (got ${JSON.stringify(value)})` });
  return n;
}

/** `k=v` pairs from repeated `--params`. */
function collectParam(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq <= 0) throw new FigureRunError({ detail: `--params takes name=value (got ${JSON.stringify(value)})` });
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}

/**
 * `--scene` alone is every captured frame; `--scene first` only the first.
 * Commander gives an optional option value the next word, so a word other than
 * "first" after `--scene` is a card path.
 */
function sceneOption(value: string | true | undefined, cards: string[]): { scene: boolean | "first"; cards: string[] } {
  if (value === undefined) return { scene: false, cards };
  if (value === true) return { scene: true, cards };
  if (value === "first") return { scene: "first", cards };
  return { scene: true, cards: [value, ...cards] };
}

function report(result: FigureRunResult): void {
  const counts = result.framesRun === undefined ? "" : ` — ${String(result.framesRun)} frames, ${String(result.imageCount ?? 0)} images`;
  const write = result.ok ? (s: string): boolean => process.stdout.write(s) : (s: string): boolean => process.stderr.write(s);
  write(`${result.ok ? "✓" : "✗"} ${result.card}${counts}\n`);
  if (result.transcript !== undefined) write(`    transcript: ${result.transcript}\n`);
  // A type check's error has one line per compiler error: indent them under it.
  for (const error of result.errors) write(`    error: ${error.replaceAll("\n", "\n      ")}\n`);
  for (const warning of result.warnings) write(`    warning: ${warning}\n`);
}

/** Each shared file's type errors once, with the figures that import it, in first-seen order. */
export function sharedTypeErrors(results: readonly FigureRunResult[]): Array<SharedTypeErrors[number] & { figures: string[] }> {
  const byFile = new Map<string, { file: string; lines: string[]; figures: string[] }>();
  for (const result of results) {
    for (const { file, lines } of result.shared ?? []) {
      const seen = byFile.get(file);
      if (seen === undefined) byFile.set(file, { file, lines, figures: [result.card] });
      else seen.figures.push(result.card);
    }
  }
  return [...byFile.values()];
}

function reportShared(shared: ReturnType<typeof sharedTypeErrors>): void {
  if (shared.length === 0) return;
  process.stderr.write("Type errors in files the figures import (each stops every figure that imports it):\n");
  for (const { file, lines, figures } of shared) {
    process.stderr.write(`  ${file} — imported by ${String(figures.length)} failing figure(s)\n`);
    for (const line of lines) process.stderr.write(`    ${line.replaceAll("\n", "\n      ")}\n`);
  }
}

/** `--lib`: type-check `src/lib/` on its own and run no figure. */
async function runLibCheck(boxRoot: string, json: boolean): Promise<boolean> {
  const { files, errors } = await checkSharedCode(boxRoot);
  if (json) process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, files, errors })}\n`);
  else {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.stdout.write(`src/lib: ${String(files)} file(s), ${String(errors.length)} type error(s)\n`);
  }
  return errors.length === 0;
}

const figureRunCommand = new Command("run")
  .description("Render canvas-loop figures headlessly: a transcript (logs, input verdicts, warnings) and frame PNGs under _tmp/figure-run/. With no card, every canvas-loop figure in the box; exit non-zero on any error")
  .argument("[cards...]", "Figure card paths (box-relative)")
  .option("--events <file>", "Events file (attach/… or a box path); default: <entry stem>-events.json beside the entry, if present")
  .option("--frames <n>", "Frames to run (default: last event frame + 60, or 120 with no events)")
  .option("--every <n>", "Also capture every Nth frame (default 30)")
  .option("--params <name=value>", "Start a declared param at this value (repeatable)", collectParam, {})
  .option("--scene [first]", "Write each captured frame's drawing as an outline into the transcript (first: only the first frame's)")
  .option("--timeout <ms>", "Stop a run after this long", String(DEFAULT_TIMEOUT_MS))
  .option("--lib", "Only type-check the box's shared code (the .ts files under src/lib/) as figure imports are checked; run no figure")
  .option("--json", "Emit { ok, figures: [...], shared: [...] }")
  .action(async (cards: string[], options: { events?: string; frames?: string; every?: string; params: Record<string, string>; scene?: string | true; timeout: string; lib?: boolean; json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      if (options.lib === true) {
        if (cards.length > 0) throw new FigureRunError({ detail: "--lib takes no card" });
        process.exitCode = (await runLibCheck(boxRoot, options.json === true)) ? 0 : 1;
        return;
      }
      const { scene, cards: named } = sceneOption(options.scene, cards);
      const targets = named.length > 0 ? named : await listCanvasLoopFigures(boxRoot);
      if (options.events !== undefined && targets.length !== 1) throw new FigureRunError({ detail: "--events needs exactly one card" });
      const timeoutMs = Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_TIMEOUT_MS;
      const results: FigureRunResult[] = [];
      for (const card of targets) {
        try {
          const { cardRel, job } = await prepareFigureJob({
            boxRoot,
            card,
            ...(options.events === undefined ? {} : { events: options.events }),
            ...(options.frames === undefined ? {} : { frames: count("frames", options.frames) }),
            ...(options.every === undefined ? {} : { every: count("every", options.every) }),
            scene,
            params: options.params,
          });
          results.push(await runFigureJob({ boxRoot, cardRel, job, timeoutMs }));
        } catch (error) {
          const shared = error instanceof FigureRunError && error.shared.length > 0 ? { shared: error.shared } : {};
          results.push({ card, ok: false, errors: [errorMessage(error)], warnings: [], ...shared });
        }
      }
      const ok = results.every((r) => r.ok);
      const shared = sharedTypeErrors(results);
      if (options.json === true) process.stdout.write(`${JSON.stringify({ ok, figures: results.map(({ shared: _s, ...r }) => r), shared })}\n`);
      else {
        for (const result of results) report(result);
        reportShared(shared);
        process.stdout.write(`${String(results.length)} figure(s), ${String(results.filter((r) => !r.ok).length)} failing\n`);
      }
      process.exitCode = ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`Error: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    } finally {
      await (await import("esbuild")).stop();
    }
  });

const figureRunOneCommand = new Command("run-one")
  .description("Internal: run one prepared figure job for `figure run`")
  .argument("<job>", "Job file written by `figure run`")
  .action(async (jobFile: string) => {
    const { runFigureOne } = await import("./run-one.js");
    await runFigureOne(jobFile);
  });

export const figureCommand = new Command("figure")
  .description("Figure cards: render canvas-loop figures headlessly")
  .addCommand(figureRunCommand)
  .addCommand(figureRunOneCommand, { hidden: true });
