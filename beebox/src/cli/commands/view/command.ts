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
 */

import { Command } from "commander";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { listViews } from "../../../webapp/views/compiler/compile.js";
import { renderView } from "./render-one.js";
import { partialRemarks } from "./check-states.js";
import { viewLintCommand } from "./lint.js";
import { typecheckViews } from "./typecheck.js";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { buildScriptEnv } from "../../../core/script-env/core.js";
import { errorMessage } from "../../../shared/error-guards.js";

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
   * type with no card that loads. One remark each.
   */
  partial?: string[];
}

const DEFAULT_VIEW_CHECK_TIMEOUT_MS = 30_000;

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
}): Promise<ViewCheckResult> {
  const { boxRoot, slug, timeoutMs, allowInvalidCards } = args;
  const bbxBin = path.join(PACKAGE_ROOT, "bin", "bbx");
  const testArgs = ["view", "render-one", slug, "--timeout", String(timeoutMs), ...(allowInvalidCards ? ["--allow-invalid-cards"] : [])];
  let env: NodeJS.ProcessEnv;
  try {
    env = await buildScriptEnv(boxRoot);
  } catch (e) {
    return { slug, ok: false, error: `could not build the render environment: ${errorMessage(e)}` };
  }
  return new Promise((resolve) => {
    const child = spawn(bbxBin, testArgs, {
      cwd: boxRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
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
    child.on("close", (code, signal) => {
      const partial = partialRemarks(stdout);
      const withNotes = partial.length > 0 ? { partial } : {};
      if (code === 0) {
        resolve({ slug, ok: true, ...withNotes });
        return;
      }
      const timedOut = signal === "SIGKILL";
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
}): Promise<{ ok: boolean; views: ViewCheckResult[] }> {
  const { boxRoot, timeoutMs } = args;
  const allowInvalidCards = args.allowInvalidCards ?? false;
  const metas = await listViews(boxRoot);
  const views: ViewCheckResult[] = [];
  for (const meta of metas) {
    views.push(await checkOneView({ boxRoot, slug: meta.slug, timeoutMs, allowInvalidCards }));
  }
  return { ok: views.every((v) => v.ok), views };
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
  .option("--json", "Emit machine-readable JSON ({ ok, views: [{ slug, ok, error? }] })")
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
      const { ok, views } = await checkViews({ boxRoot, timeoutMs, allowInvalidCards: options.allowInvalidCards === true });

      if (options.json === true) {
        process.stdout.write(JSON.stringify({ ok, views }) + "\n");
      } else {
        for (const v of views) {
          if (!v.ok) process.stderr.write(`✗ ${v.slug}: ${v.error ?? "failed"}\n`);
          else if (v.partial === undefined) process.stdout.write(`✓ ${v.slug}\n`);
          else process.stdout.write(`~ ${v.slug} (partly checked)\n`);
          for (const remark of v.partial ?? []) process.stdout.write(`    ${remark}\n`);
        }
        const failing = views.filter((v) => !v.ok).length;
        const partly = views.filter((v) => v.ok && v.partial !== undefined).length;
        process.stdout.write(`${String(views.length)} view(s), ${String(failing)} failing${partly > 0 ? `, ${String(partly)} partly checked` : ""}\n`);
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
  .action(
    async (
      slug: string,
      options: { allowInvalidCards?: boolean; timeout?: string }
    ) => {
      try {
        const boxRoot = await requireBoxRoot();
        const code = await renderView({
          boxRoot,
          slug,
          allowInvalidCards: options.allowInvalidCards === true,
          timeoutMs: Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_VIEW_CHECK_TIMEOUT_MS,
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
  .addCommand(viewCheckCommand)
  .addCommand(viewTypecheckCommand)
  .addCommand(viewLintCommand);
