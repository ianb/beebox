/**
 * bbx view check - Render every agent-authored view in Node and report.
 *
 * Each view renders in a killable child (the hidden `bbx view render-one`),
 * which compiles the view for the node target (real React, not the browser
 * window-shim), loads the same cards the running app would pass it, renders it
 * once with renderToString, and prints the output — or, on failure, the error
 * with a source-mapped stack. Runs in-process: no server, and it spawns nothing
 * long-lived (esbuild's service child is torn down via esbuild.stop()), so
 * nothing can orphan in the background.
 *
 * Note: this executes the box-authored view code in the bbx process (the same
 * code the browser would run). That's acceptable under the box trust model — a
 * box agent already has a shell — but it does mean a pathological view (an
 * infinite loop in the render body, or a stray setInterval) can hang the
 * child; `bbx view check` kills it at its timeout.
 *
 * Each view renders in each check state (`check-states.ts`: no card, and one
 * card of each type it renders) twice. The first frame is renderToString: it
 * runs the component body once, and the async ViewProps helpers throw if
 * called there (that's a view bug; fileUrl returns a string and is fine). The
 * settled render (`settle.ts`) then runs effects in a jsdom document with
 * `readFile` answered from the box, so a view that crashes once its data
 * loads fails too (docs/implemented-plans/view-check-settled-render.md).
 *
 * A view that passes then gets advice (`advise.ts`): patterns the views doc
 * forbids, printed under its line. Advice never changes `ok` or the exit code.
 */

import { Command } from "commander";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { listViews } from "../../../webapp/views/compiler/compile.js";
import { renderView } from "./render-one.js";
import { ADVICE_NOT_CHECKED, partialRemarks } from "./check-states.js";
import { viewLintCommand } from "./lint.js";
import { viewStatesCommand } from "./states.js";
import { typecheckViews } from "./typecheck.js";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { buildScriptEnv } from "../../../core/script-env/core.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { mergeAdvice, type ViewAdvice } from "../../../core/views/advice/core.js";
import { spawnAdvise, viewAdviseCommand, type AdviceOutcome, type AdviseRunner } from "./advise.js";

/** Per-view outcome from `bbx view check`. */
export interface ViewCheckResult {
  slug: string;
  ok: boolean;
  /** True when the render was killed by the timeout (a hang), not a thrown error. */
  timedOut?: boolean;
  /** Failure detail (render error or timeout note); absent when `ok`. */
  error?: string;
  /**
   * Present when the view rendered but was not fully checked: a state still
   * loading at its settle budget, a write the check did not perform, a card
   * type with no card that loads, advice that could not run. One remark each.
   */
  partial?: string[];
  /** Patterns the views doc forbids, by rule; present only on a passing view that has some. */
  advice?: ViewAdvice[];
}

const DEFAULT_VIEW_CHECK_TIMEOUT_MS = 30_000;

/** Where a view's snapshot goes: one fresh directory per view, removed after its advice. */
export interface SnapshotDirs {
  make: () => Promise<string>;
  remove: (dir: string) => Promise<void>;
}

const TEMP_SNAPSHOT_DIRS: SnapshotDirs = {
  make: () => mkdtemp(path.join(tmpdir(), "bbx-view-check-")),
  remove: (dir) => rm(dir, { recursive: true, force: true }),
};

/**
 * Render one view in a killable child process (the hidden `bbx view render-one <slug>`) with a
 * hard timeout. A child is the only way to interrupt a pathological view whose
 * render body loops synchronously — an in-process timeout can't fire while the
 * event loop is blocked. SIGKILL guarantees the hang dies. Never rejects:
 * spawn/exit failures resolve to `ok: false` so one bad view can't abort the
 * sweep.
 *
 * The child runs box-authored view code, so it gets the agent profile
 * (`buildScriptEnv`), never this process's own environment.
 */
async function checkOneView(args: {
  boxRoot: string;
  slug: string;
  timeoutMs: number;
  allowInvalidCards: boolean;
  advise: AdviseRunner;
  snapshotDirs: SnapshotDirs;
  signal: AbortSignal | undefined;
}): Promise<ViewCheckResult> {
  const { boxRoot, slug, advise, snapshotDirs, signal } = args;
  let env: NodeJS.ProcessEnv;
  try {
    env = await buildScriptEnv(boxRoot);
  } catch (e) {
    return { slug, ok: false, error: `could not build the render environment: ${errorMessage(e)}` };
  }
  // The sweep names the snapshot file, so nothing the view prints can point
  // it elsewhere. Advice never changes the result: without a directory the
  // view renders with no snapshot and gets a remark instead of advice.
  let dir: string;
  try {
    dir = await snapshotDirs.make();
  } catch (e) {
    const result = await renderInChild({ ...args, env, snapshotPath: null });
    return result.ok ? withRemarks(result, [`${ADVICE_NOT_CHECKED}could not make the snapshot directory: ${errorMessage(e)}`]) : result;
  }
  // Neither the render child nor the advice step rejects, so the removal below always runs.
  const snapshotPath = path.join(dir, "snapshot.json");
  let result = await renderInChild({ ...args, env, snapshotPath });
  // A render child that could not write the snapshot already said so.
  if (result.ok && !(result.partial ?? []).some((remark) => remark.startsWith(ADVICE_NOT_CHECKED))) {
    let outcome: AdviceOutcome;
    try {
      outcome = await advise({ boxRoot, slug, snapshotPath, env, signal });
    } catch (e) {
      outcome = { advice: [], partial: [`${ADVICE_NOT_CHECKED}${errorMessage(e)}`] };
    }
    const advice = mergeAdvice(outcome.advice);
    result = { ...withRemarks(result, outcome.partial), ...(advice.length > 0 ? { advice } : {}) };
  }
  try {
    await snapshotDirs.remove(dir);
  } catch (e) {
    // The directory holds rendered box content; say where it was left.
    result = withRemarks(result, [`snapshot not removed: ${dir}: ${errorMessage(e)}`]);
  }
  return result;
}

/** `result` with `remarks` added to its partial-check remarks. */
function withRemarks(result: ViewCheckResult, remarks: readonly string[]): ViewCheckResult {
  const partial = [...(result.partial ?? []), ...remarks];
  return partial.length > 0 ? { ...result, partial } : result;
}

/** The render child's outcome for one view; `ok` is decided here and nowhere else. */
function renderInChild(args: {
  boxRoot: string;
  slug: string;
  timeoutMs: number;
  allowInvalidCards: boolean;
  env: NodeJS.ProcessEnv;
  /** Null: render with no snapshot (the sweep has nowhere to put one). */
  snapshotPath: string | null;
  /** Aborting it kills the child (SIGKILL). */
  signal: AbortSignal | undefined;
}): Promise<ViewCheckResult> {
  const { boxRoot, slug, timeoutMs, allowInvalidCards, env, snapshotPath, signal } = args;
  const bbxBin = path.join(PACKAGE_ROOT, "bin", "bbx");
  const testArgs = [
    "view", "render-one", slug, "--timeout", String(timeoutMs),
    ...(snapshotPath === null ? [] : ["--snapshot", snapshotPath]),
    ...(allowInvalidCards ? ["--allow-invalid-cards"] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn(bbxBin, testArgs, {
      cwd: boxRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      ...(signal === undefined ? {} : { signal }),
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", (e) => {
      resolve({ slug, ok: false, error: `could not run bbx view render-one: ${e.message}` });
    });
    child.on("close", (code, exitSignal) => {
      const partial = partialRemarks(stdout);
      const withNotes = partial.length > 0 ? { partial } : {};
      if (code === 0) {
        resolve({ slug, ok: true, ...withNotes });
        return;
      }
      const timedOut = exitSignal === "SIGKILL";
      const error = timedOut
        ? `render timed out after ${String(timeoutMs)}ms`
        : stderr.trim() || `bbx view render-one exited with code ${String(code ?? "null")}`;
      resolve({ slug, ok: false, ...(timedOut ? { timedOut: true } : {}), error, ...withNotes });
    });
  });
}

/**
 * Render every view in the box and report which fail. The whole-box gate (a
 * migration's `validate.shells` check) and the broken-view detector. Sequential
 * by design: each child may self-heal the CLI bundle on first run, and a
 * migration check is not a hot path — so we avoid racing rebuilds and resource
 * spikes rather than parallelize.
 *
 * A view that renders card types also renders with one card of each type as
 * `params.path` (`check-states.ts`), answering the agent-applied migrations
 * plan's Open q4 with one card per type.
 */
export async function checkViews(args: {
  boxRoot: string;
  timeoutMs: number;
  allowInvalidCards?: boolean;
  /** Runs advice for a passing view; tests pass a slow or failing one. */
  advise?: AdviseRunner;
  /** Makes and removes each view's snapshot directory; tests pass failing ones. */
  snapshotDirs?: SnapshotDirs;
  /** Aborting stops the running child and ends the sweep after its cleanup. */
  signal?: AbortSignal;
}): Promise<{ ok: boolean; views: ViewCheckResult[] }> {
  const { boxRoot, timeoutMs, signal } = args;
  const allowInvalidCards = args.allowInvalidCards ?? false;
  const advise = args.advise ?? spawnAdvise;
  const snapshotDirs = args.snapshotDirs ?? TEMP_SNAPSHOT_DIRS;
  const metas = await listViews(boxRoot);
  const views: ViewCheckResult[] = [];
  for (const meta of metas) {
    if (signal?.aborted === true) break;
    views.push(await checkOneView({ boxRoot, slug: meta.slug, timeoutMs, allowInvalidCards, advise, snapshotDirs, signal }));
  }
  return { ok: views.every((v) => v.ok), views };
}

/**
 * Run `work` so SIGINT or SIGTERM aborts its signal instead of killing this
 * process at once: the sweep then kills its child and removes the snapshot
 * directory (rendered box content) before the command exits 128 + the
 * signal number. A second signal kills at once. SIGKILL cannot be caught.
 */
async function withTerminationCleanup<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T & { interrupted: "SIGINT" | "SIGTERM" | null }> {
  const controller = new AbortController();
  let interrupted: "SIGINT" | "SIGTERM" | null = null;
  const onInt = () => { interrupted = "SIGINT"; controller.abort(); };
  const onTerm = () => { interrupted = "SIGTERM"; controller.abort(); };
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  try {
    const result = await work(controller.signal);
    return { ...result, interrupted };
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
}

/** At most `WHERE_SHOWN` places, then how many more. */
const WHERE_SHOWN = 3;
function whereList(where: readonly string[]): string {
  const shown = where.slice(0, WHERE_SHOWN).join(", ");
  return where.length > WHERE_SHOWN ? `${shown} and ${String(where.length - WHERE_SHOWN)} more` : shown;
}

const viewTypecheckCommand = new Command("typecheck")
  .description("Type-check every view against the real ViewProps; exit non-zero on type errors")
  .option("--json", "Emit machine-readable JSON ({ ok, views: [{ slug, ok, errors? }] })")
  .action(async (options: { json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const { ok, views } = await typecheckViews(boxRoot);
      if (options.json === true) {
        process.stdout.write(JSON.stringify({ ok, views }) + "\n");
      } else {
        for (const v of views) {
          if (v.ok) {
            process.stdout.write(`✓ ${v.slug}\n`);
          } else {
            process.stderr.write(`✗ ${v.slug}\n`);
            for (const e of v.errors ?? []) process.stderr.write(`    ${e}\n`);
          }
        }
        const failing = views.filter((v) => !v.ok).length;
        process.stdout.write(`${String(views.length)} view(s), ${String(failing)} with type errors\n`);
      }
      process.exitCode = ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`Error: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

const viewCheckCommand = new Command("check")
  .description("Render every view in the box; exit non-zero if any fails")
  .option("--json", "Emit machine-readable JSON ({ ok, views: [{ slug, ok, error?, partial?, advice? }] })")
  .option(
    "--timeout <ms>",
    "Per-view render timeout in milliseconds",
    String(DEFAULT_VIEW_CHECK_TIMEOUT_MS)
  )
  .option("--allow-invalid-cards", "Treat a view as OK if it renders but a dependency card fails to load")
  .action(async (options: { json?: boolean; timeout?: string; allowInvalidCards?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const parsed = Number(options.timeout);
      const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VIEW_CHECK_TIMEOUT_MS;
      const { ok, views, interrupted } = await withTerminationCleanup((signal) =>
        checkViews({ boxRoot, timeoutMs, allowInvalidCards: options.allowInvalidCards === true, signal }));
      if (interrupted !== null) {
        process.exitCode = 128 + constants.signals[interrupted];
        return;
      }

      if (options.json === true) {
        process.stdout.write(JSON.stringify({ ok, views }) + "\n");
      } else {
        for (const v of views) {
          if (!v.ok) process.stderr.write(`✗ ${v.slug}: ${v.error ?? "failed"}\n`);
          else if (v.partial === undefined) process.stdout.write(`✓ ${v.slug}\n`);
          else process.stdout.write(`~ ${v.slug} (partly checked)\n`);
          for (const remark of v.partial ?? []) process.stdout.write(`    ${remark}\n`);
          for (const a of v.advice ?? []) process.stdout.write(`    advice: ${a.message} — ${whereList(a.where)}\n`);
        }
        const failing = views.filter((v) => !v.ok).length;
        const partly = views.filter((v) => v.ok && v.partial !== undefined).length;
        const advised = views.filter((v) => v.advice !== undefined).length;
        process.stdout.write(`${String(views.length)} view(s), ${String(failing)} failing${partly > 0 ? `, ${String(partly)} partly checked` : ""}${advised > 0 ? `, ${String(advised)} with advice` : ""}\n`);
      }
      process.exitCode = ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`Error: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

const viewRenderOneCommand = new Command("render-one")
  .description("Internal: render one view for `view check` (exit non-zero on failure)")
  .argument("<slug>", "View slug (the views/<slug>.tsx basename)")
  .option("--allow-invalid-cards", "Exit 0 even if some selected cards failed to load")
  .option("--timeout <ms>", "The sweep's per-view timeout, shared by the settled renders", String(DEFAULT_VIEW_CHECK_TIMEOUT_MS))
  .option("--snapshot <path>", "Write each state's settled DOM here when the view passes, for advice")
  .action(
    async (
      slug: string,
      options: { allowInvalidCards?: boolean; timeout?: string; snapshot?: string }
    ) => {
      try {
        const boxRoot = await requireBoxRoot();
        const code = await renderView({
          boxRoot,
          slug,
          allowInvalidCards: options.allowInvalidCards === true,
          timeoutMs: Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_VIEW_CHECK_TIMEOUT_MS,
          ...(options.snapshot === undefined ? {} : { snapshotPath: options.snapshot }),
        });
        process.exitCode = code;
      } catch (error) {
        process.stderr.write(`Error: ${errorMessage(error)}\n`);
        process.exitCode = 1;
      } finally {
        // Tear down esbuild's service child deterministically — nothing
        // long-lived survives this command.
        await (await import("esbuild")).stop();
        // A view can leave a timer running after unmount; exit rather than
        // wait for it, once both streams have flushed.
        await new Promise<void>((resolve) => { process.stdout.write("", () => { resolve(); }); });
        await new Promise<void>((resolve) => { process.stderr.write("", () => { resolve(); }); });
        process.exit();
      }
    }
  );

export const viewCommand = new Command("view")
  .description("Work with agent-authored views")
  .addCommand(viewRenderOneCommand, { hidden: true })
  .addCommand(viewAdviseCommand, { hidden: true })
  .addCommand(viewCheckCommand)
  .addCommand(viewTypecheckCommand)
  .addCommand(viewLintCommand)
  .addCommand(viewStatesCommand);
