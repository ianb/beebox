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
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import * as esbuild from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { load as cheerioLoad } from "cheerio";
import { requireBoxRoot } from "../lib/paths.js";
import { compileView } from "../../webapp/views/compiler.js";
import { loadViewCards } from "../../core/view-cards.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import type { ViewProps } from "../../types/views.js";

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

/** Strip <script>/<style> from rendered HTML (mirrors `cb render`); --raw keeps them. */
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
  const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
  try {
    await fs.access(viewPath);
  } catch (_e) {
    throw new ViewNotFoundError(slug, viewPath);
  }

  // Compile for Node (real React) and load the same data the app passes.
  const { output, meta } = await compileView(viewPath, { target: "node" });
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

  // Write the compiled module to a temp file under the package's node_modules
  // cache: bare `react`/`react/jsx-runtime` imports resolve to the same
  // node_modules React this process uses (single instance — hooks work, no
  // dispatcher mismatch), and it's a gitignored, writable location, so a file
  // leaked by an interrupted run never lands in the tracked tree.
  const tmpDir = path.join(PACKAGE_ROOT, "node_modules", ".cache", "cb-view-test");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `view-${randomUUID()}.mjs`);
  await fs.writeFile(tmpFile, output, "utf-8");
  try {
    process.setSourceMapsEnabled(true);

    // Import (module evaluation) and render share one diagnostic block so a
    // top-level throw in the view gets the same source-mapped stack a render
    // throw does — both are the same class of authoring bug.
    let html: string;
    try {
      const mod = (await import(pathToFileURL(tmpFile).href)) as LoadedViewModule;
      const props = buildProps({ cards, files, params, boxSlug: path.basename(boxRoot) });
      html = renderToString(createElement(mod.default, props));
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
    await fs.rm(tmpFile, { force: true });
  }
}

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
        process.stderr.write(`Error: ${(error as Error).message}\n`);
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
  .addCommand(viewTestCommand);
