/**
 * `bbx figure`: commands for figure cards. `run` renders canvas-loop figures
 * headlessly (see run.ts); `run-one` is its internal child.
 */
import { Command } from "commander";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { FigureRunError, listCanvasLoopFigures, prepareFigureJob, runFigureJob, type FigureRunResult } from "./run.js";

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

function report(result: FigureRunResult): void {
  const counts = result.framesRun === undefined ? "" : ` — ${String(result.framesRun)} frames, ${String(result.imageCount ?? 0)} images`;
  const write = result.ok ? (s: string): boolean => process.stdout.write(s) : (s: string): boolean => process.stderr.write(s);
  write(`${result.ok ? "✓" : "✗"} ${result.card}${counts}\n`);
  if (result.transcript !== undefined) write(`    transcript: ${result.transcript}\n`);
  for (const error of result.errors) write(`    error: ${error}\n`);
  for (const warning of result.warnings) write(`    warning: ${warning}\n`);
}

const figureRunCommand = new Command("run")
  .description("Render canvas-loop figures headlessly: a transcript (logs, input verdicts, warnings) and frame PNGs under _tmp/figure-run/. With no card, every canvas-loop figure in the box; exit non-zero on any error")
  .argument("[cards...]", "Figure card paths (box-relative)")
  .option("--events <file>", "Events file (attach/… or a box path); default: <entry stem>-events.json beside the entry, if present")
  .option("--frames <n>", "Frames to run (default: last event frame + 60, or 120 with no events)")
  .option("--every <n>", "Also capture every Nth frame (default 30)")
  .option("--params <name=value>", "Start a declared param at this value (repeatable)", collectParam, {})
  .option("--timeout <ms>", "Stop a run after this long", String(DEFAULT_TIMEOUT_MS))
  .option("--json", "Emit { ok, figures: [...] }")
  .action(async (cards: string[], options: { events?: string; frames?: string; every?: string; params: Record<string, string>; timeout: string; json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const targets = cards.length > 0 ? cards : await listCanvasLoopFigures(boxRoot);
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
            params: options.params,
          });
          results.push(await runFigureJob({ boxRoot, cardRel, job, timeoutMs }));
        } catch (error) {
          results.push({ card, ok: false, errors: [errorMessage(error)], warnings: [] });
        }
      }
      const ok = results.every((r) => r.ok);
      if (options.json === true) process.stdout.write(`${JSON.stringify({ ok, figures: results })}\n`);
      else {
        for (const result of results) report(result);
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
