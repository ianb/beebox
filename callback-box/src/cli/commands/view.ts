/**
 * cb view test - Render an agent-authored view in Node and report.
 *
 * Compiles the view for the node target (real React, not the browser
 * window-shim), loads the same cards the running app would pass it, renders it
 * once with renderToString, and prints the output — or, on failure, the error
 * with a source-mapped stack. Runs in-process: no server, and it spawns nothing
 * long-lived (esbuild's service child is torn down via esbuild.stop()), so
 * nothing can orphan in the background.
 *
 * Note: this executes the box-authored view code in the cb process (the same
 * code the browser would run). That's acceptable under the box trust model — a
 * box agent already has a shell — but it does mean a pathological view (an
 * infinite loop in the render body, or a stray setInterval) can hang this
 * foreground command. That's a killable hang, not a background orphan; the
 * caller (the agent) interrupts it. v1 deliberately stays in-process rather than
 * isolating the render in a killable child + timeout.
 *
 * v1 is a synchronous render: renderToString runs the component body once and
 * does NOT run effects. It catches syntax/JSX errors, undefined.map, bad prop
 * access, and type coercion — the bulk of view bugs — but not useEffect/async
 * helpers. The async ViewProps helpers throw if called during render (that's a
 * view bug); fileUrl returns a string (it's legitimately used in render).
 */

import { Command } from "commander";
import * as path from "node:path";
import { boxSlug as resolveBoxSlug } from "../../lib/box-slug.js";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { load as cheerioLoad } from "cheerio";
import { requireBoxRoot } from "../../lib/paths.js";
import { compileView, listViews, resolveViewsDir } from "../../webapp/views/compiler.js";
import { writeNodeViewModule, boxPackageHost } from "../../webapp/views/node-view-runtime.js";
import { viewLintCommand } from "./view-lint.js";
import { loadViewCards } from "../../core/views/cards.js";
import { typecheckViews } from "./view-typecheck.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import type { ViewProps } from "../../core/views/types.js";
import { errorMessage } from "../../lib/error-guards.js";

/** The view's slug doesn't resolve to a `views/<slug>.tsx` file. */
class ViewNotFoundError extends Error {
  constructor(slug: string, viewPath: string) {
    super(`View not found: ${slug} (looked for ${viewPath})`);
    this.name = "ViewNotFoundError";
  }
}

/**
 * An async ViewProps helper was called during synchronous render. These run
 * only in effects/handlers, which `cb view test` (v1) does not execute — so a
 * render-time call is a view bug. Thrown loudly rather than returning empty.
 */
class ViewHelperDuringRenderError extends Error {
  constructor(helper: string) {
    super(
      `${helper}() was called during render — async helpers only run in effects/handlers, ` +
        "which 'cb view test' does not execute (v1 renders the component body once)."
    );
    this.name = "ViewHelperDuringRenderError";
  }
}

interface LoadedViewModule {
  default: ComponentType<ViewProps>;
}

/**
 * Build the ViewProps a view receives. Real cards/files + params; per-helper
 * mock policy (see file header). The async helpers throw; fileUrl/navigate/
 * reportActivity are synchronous no-ops/strings safe to call during render.
 */
function buildProps(opts: {
  cards: ViewProps["cards"];
  files: ViewProps["files"];
  params: Record<string, string>;
  boxSlug: string;
}): ViewProps {
  const { cards, files, params, boxSlug } = opts;
  const throwDuringRender = (helper: string) => (): never => {
    throw new ViewHelperDuringRenderError(helper);
  };
  return {
    cards,
    files,
    params,
    boxSlug,
    fileUrl: (filePath: string) => `/api/files/${filePath}`,
    navigate: () => {},
    reportActivity: () => {},
    readFile: throwDuringRender("readFile"),
    writeFile: throwDuringRender("writeFile"),
    appendFile: throwDuringRender("appendFile"),
    commitFile: throwDuringRender("commitFile"),
    adapterFetch: throwDuringRender("adapterFetch"),
  };
}

/** Strip <script>/<style> from rendered HTML; --raw keeps them. */
function postProcess(html: string, { raw }: { raw: boolean }): string {
  if (raw) return html;
  const $ = cheerioLoad(html);
  $("script").remove();
  $("style").remove();
  return $.html();
}

interface RenderViewOptions {
  boxRoot: string;
  slug: string;
  focusPath: string | undefined;
  raw: boolean;
  allowInvalidCards: boolean;
}

/**
 * The whole render flow. Returns a process exit code; never calls process.exit
 * itself, so cleanup (esbuild.stop, temp unlink) always runs in the action's
 * finally. Diagnostics go to stderr, the rendered output to stdout.
 */
async function renderView(options: RenderViewOptions): Promise<number> {
  const { boxRoot, slug, focusPath, raw, allowInvalidCards } = options;
  const { viewsDir, boxShape } = await resolveViewsDir(boxRoot);
  const viewHost = boxPackageHost(boxShape);
  const viewPath = path.join(viewsDir, `${slug}.tsx`);
  try {
    await fs.access(viewPath);
  } catch (_e) {
    throw new ViewNotFoundError(slug, viewPath);
  }

  // Compile for Node (real React) and load the same data the app passes.
  const { output, meta } = await compileView(viewPath, { target: "node", viewHost });
  const { cards, files, skipped } = await loadViewCards(boxRoot, meta.dependencies);

  // --path sets params.path (it does NOT filter cards — the running app
  // doesn't either; card-bound views self-filter). Warn if the path isn't among
  // the loaded cards, since that means the view's globs don't select it.
  const params: Record<string, string> = {};
  if (focusPath !== undefined) {
    params.path = focusPath;
    if (!cards.some((c) => c.path === focusPath)) {
      process.stderr.write(
        `Warning: --path ${focusPath} is not among the ${String(cards.length)} card(s) this view's ` +
          "dependencies select; the view will render without it.\n"
      );
    }
  }

  // The compiled module imports `react`/`react/jsx-runtime` as bare specifiers
  // and must resolve them to the SAME instance the host react-dom/server uses
  // (single instance — hooks work, no dispatcher mismatch). writeNodeViewModule
  // sets up a temp node_modules for the view-host context: a real box package
  // carries a node_modules/callback-box (and react beside it), so it resolves
  // through THAT directly (box-package host).
  const mod = await writeNodeViewModule(output, viewHost);
  try {
    process.setSourceMapsEnabled(true);

    // Import (module evaluation) and render share one diagnostic block so a
    // top-level throw in the view gets the same source-mapped stack a render
    // throw does — both are the same class of authoring bug.
    let html: string;
    try {
      // eslint-disable-next-line no-restricted-syntax -- dynamic import of a runtime-computed module URL yields an untyped namespace; cast to the known compiled-view contract (validated by the render call that follows)
      const viewMod = (await import(mod.moduleUrl)) as LoadedViewModule;
      const props = buildProps({ cards, files, params, boxSlug: await resolveBoxSlug(boxRoot) });
      // Wrap in the node view host so the card widgets (<CardLink>/<CardRef>)
      // resolve their context. NodeViewHostProvider comes from the same
      // dist/view-widgets bundle the view's widgets do (view.ts self-references
      // the package's exports map), so the ViewHostContext identity matches.
      const { NodeViewHostProvider } = await import("callback-box/view-widgets");
      html = renderToString(
        createElement(NodeViewHostProvider, null, createElement(viewMod.default, props)),
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      process.stderr.write(`View render failed: ${err.name}: ${err.message}\n`);
      if (err.stack) process.stderr.write(`${err.stack}\n`);
      return 1;
    }

    process.stdout.write(postProcess(html, { raw }) + "\n");

    // Cards that matched a dependency glob but failed to load. The live app
    // omits them silently; a test tool surfaces them as author feedback.
    if (skipped.length > 0) {
      process.stderr.write(`\n${String(skipped.length)} card(s) selected by dependencies failed to load:\n`);
      for (const s of skipped) process.stderr.write(`  ${s.path}: ${s.error}\n`);
      if (!allowInvalidCards) {
        process.stderr.write("(pass --allow-invalid-cards to treat this as success)\n");
        return 1;
      }
    }
    return 0;
  } finally {
    await mod.cleanup();
  }
}

/** Per-view outcome from `cb view check`. */
export interface ViewCheckResult {
  slug: string;
  ok: boolean;
  /** True when the render was killed by the timeout (a hang), not a thrown error. */
  timedOut?: boolean;
  /** Failure detail (render error or timeout note); absent when `ok`. */
  error?: string;
}

const DEFAULT_VIEW_CHECK_TIMEOUT_MS = 30_000;

/**
 * Render one view in a killable child process (`cb view test <slug>`) with a
 * hard timeout. A child is the only way to interrupt a pathological view whose
 * render body loops synchronously — an in-process timeout can't fire while the
 * event loop is blocked. SIGKILL guarantees the hang dies. Never rejects:
 * spawn/exit failures resolve to `ok: false` so one bad view can't abort the
 * sweep.
 */
function checkOneView(args: {
  boxRoot: string;
  slug: string;
  timeoutMs: number;
  allowInvalidCards: boolean;
}): Promise<ViewCheckResult> {
  const { boxRoot, slug, timeoutMs, allowInvalidCards } = args;
  const cbBin = path.join(PACKAGE_ROOT, "bin", "cb");
  const testArgs = ["view", "test", slug, ...(allowInvalidCards ? ["--allow-invalid-cards"] : [])];
  return new Promise((resolve) => {
    const child = spawn(cbBin, testArgs, {
      cwd: boxRoot,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (e) => {
      resolve({ slug, ok: false, error: `could not run cb view test: ${e.message}` });
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ slug, ok: true });
        return;
      }
      const timedOut = signal === "SIGKILL";
      const error = timedOut
        ? `render timed out after ${String(timeoutMs)}ms`
        : stderr.trim() || `cb view test exited with code ${String(code ?? "null")}`;
      resolve({ slug, ok: false, ...(timedOut ? { timedOut: true } : {}), error });
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
 * v1 renders each view with default params (no `params.path`). A card-bound view
 * that only breaks for a specific `params.path` is not yet exercised — the
 * `params.path` sampling policy is a tracked follow-up (see the agent-applied
 * migrations plan, Open q4).
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
          if (v.ok) {
            process.stdout.write(`✓ ${v.slug}\n`);
          } else {
            process.stderr.write(`✗ ${v.slug}: ${v.error ?? "failed"}\n`);
          }
        }
        const failing = views.filter((v) => !v.ok).length;
        process.stdout.write(`${String(views.length)} view(s), ${String(failing)} failing\n`);
      }
      process.exitCode = ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`Error: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });

const viewTestCommand = new Command("test")
  .description("Render a view in Node and print its output (or the error)")
  .argument("<slug>", "View slug (the views/<slug>.tsx basename)")
  .option("--path <cardPath>", "Set params.path (box-relative card path) for a card-bound view")
  .option("--raw", "Keep <script>/<style> in the rendered HTML")
  .option("--allow-invalid-cards", "Exit 0 even if some selected cards failed to load")
  .action(
    async (
      slug: string,
      options: { path?: string; raw?: boolean; allowInvalidCards?: boolean }
    ) => {
      try {
        const boxRoot = await requireBoxRoot();
        const code = await renderView({
          boxRoot,
          slug,
          focusPath: options.path,
          raw: options.raw === true,
          allowInvalidCards: options.allowInvalidCards === true,
        });
        process.exitCode = code;
      } catch (error) {
        process.stderr.write(`Error: ${errorMessage(error)}\n`);
        process.exitCode = 1;
      } finally {
        // Tear down esbuild's service child deterministically — nothing
        // long-lived survives this command.
        await esbuild.stop();
      }
    }
  );

export const viewCommand = new Command("view")
  .description("Work with agent-authored views")
  .addCommand(viewTestCommand)
  .addCommand(viewCheckCommand)
  .addCommand(viewTypecheckCommand)
  .addCommand(viewLintCommand);
