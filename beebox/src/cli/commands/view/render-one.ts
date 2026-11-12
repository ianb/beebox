/**
 * The render behind the hidden `bbx view render-one <slug>`, the per-view
 * child `bbx view check` spawns (`command.ts`). It compiles the view for the
 * node target, loads the cards the app would pass it, and renders it in each
 * check state: the first frame with renderToString, then the settled render
 * (docs/implemented-plans/view-check-settled-render.md).
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { createElement, type ComponentType } from "react";
import { boxSlug as resolveBoxSlug } from "../../../lib/box-slug.js";
import { compileView, resolveViewsDir } from "../../../webapp/views/compiler/compile.js";
import { writeNodeViewModule, boxPackageHost } from "../../../webapp/views/node-view-runtime.js";
import { loadViewCards } from "../../../core/views/cards.js";
import type { ViewProps } from "../../../core/views/types.js";
import { statesToCheck, snapshotOf, ADVICE_NOT_CHECKED, PARTIAL_PREFIX, type CheckState, type ViewDomSnapshot } from "./check-states.js";
import { settledRender, SETTLE_BUDGET_MS } from "./settle.js";
import { errorMessage } from "../../../shared/error-guards.js";

/** The view's slug doesn't resolve to a `views/<slug>.tsx` file. */
class ViewNotFoundError extends Error {
  constructor(slug: string, viewPath: string) {
    super(`View not found: ${slug} (looked for ${viewPath})`);
    this.name = "ViewNotFoundError";
  }
}

/**
 * An async ViewProps helper was called during synchronous render. These run
 * only in effects/handlers, which the render check (v1) does not execute — so a
 * render-time call is a view bug. Thrown loudly rather than returning empty.
 */
class ViewHelperDuringRenderError extends Error {
  constructor(helper: string) {
    super(
      `${helper}() was called during render — async helpers only run in effects/handlers, ` +
        "so call it from one (the check's first frame renders the component body without them)."
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
/** The props `bbx view check` renders a view with; also what view tests render with. */
export function buildProps(opts: {
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
    viewHistory: {
      state: {},
      canPush: false,
      pushState: () => "replaced",
      replaceState: () => {},
    },
    boxSlug,
    fileUrl: (filePath: string) => `/api/files/${filePath}`,
    imageUrl: (filePath: string, options) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) query.set(key, String(value));
      }
      return `/api/images/${filePath}?${query.toString()}`;
    },
    navigate: () => {},
    reportActivity: () => {},
    readFile: throwDuringRender("readFile"),
    writeFile: throwDuringRender("writeFile"),
    appendFile: throwDuringRender("appendFile"),
    commitFile: throwDuringRender("commitFile"),
    adapterFetch: throwDuringRender("adapterFetch"),
  };
}

interface RenderViewOptions {
  boxRoot: string;
  slug: string;
  allowInvalidCards: boolean;
  /** The sweep's per-view timeout; the settled renders share what is left of it. */
  timeoutMs: number;
  /** Where to write each state's settled DOM (`ViewDomSnapshot[]`) when the view passes. */
  snapshotPath?: string;
}

/** Room left at the end of the per-view timeout for cleanup and the report. */
const TIMEOUT_MARGIN_MS = 2_000;

/**
 * The whole render flow. Returns a process exit code; never calls process.exit
 * itself, so cleanup (esbuild.stop, temp unlink) always runs in the action's
 * finally. Diagnostics go to stderr; partial-check remarks (`PARTIAL_PREFIX`
 * lines) to stdout.
 */
export async function renderView(options: RenderViewOptions): Promise<number> {
  const { boxRoot, slug, allowInvalidCards } = options;
  const deadline = Date.now() + options.timeoutMs - TIMEOUT_MARGIN_MS;
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
  // An invalid export leaves the defaults (no dependencies), so a render
  // would check a view the app never shows.
  if (meta.metadataError !== undefined) {
    process.stderr.write(`View metadata export is invalid: ${meta.metadataError}\n`);
    return 1;
  }
  const { cards, files, skipped } = await loadViewCards(boxRoot, meta.dependencies);

  // The sample comes from the cards the view receives: the app passes only
  // its dependency cards, so a card outside them takes the not-found branch
  // there too, and would prove nothing here.
  const received = new Set(cards.map((card) => card.path));
  const boxCardPaths = [...received];
  const loads = (cardPath: string) => Promise.resolve(received.has(cardPath));
  const { states, untested } = await statesToCheck({ rendersCardTypes: meta.rendersCardTypes, declared: meta.checkStates, boxCardPaths, loads });
  for (const remark of untested) process.stdout.write(`${PARTIAL_PREFIX}${remark}\n`);

  // The compiled module imports `react`/`react/jsx-runtime` as bare specifiers
  // and must resolve them to the SAME instance the host react-dom/server uses
  // (single instance — hooks work, no dispatcher mismatch). writeNodeViewModule
  // sets up a temp node_modules for the view-host context: a real box package
  // carries a node_modules/beebox (and react beside it), so it resolves
  // through THAT directly (box-package host).
  const mod = await writeNodeViewModule(output, viewHost);
  try {
    process.setSourceMapsEnabled(true);
    let state: CheckState | null = null;
    let stage = "first frame";
    const snapshots: ViewDomSnapshot[] = [];
    // Import (module evaluation) and render share one diagnostic block so a
    // top-level throw in the view gets the same source-mapped stack a render
    // throw does — both are the same class of authoring bug.
    try {
      // eslint-disable-next-line no-restricted-syntax -- dynamic import of a runtime-computed module URL yields an untyped namespace; cast to the known compiled-view contract (validated by the render call that follows)
      const viewMod = (await import(mod.moduleUrl)) as LoadedViewModule;
      const boxSlug = await resolveBoxSlug(boxRoot);
      // Wrap in the node view host so the widgets (<CardLink>/<CardRef>/<Markdown>)
      // resolve their context. NodeViewHostProvider comes from the same
      // dist/view-widgets bundle the view's widgets do (view.ts self-references
      // the package's exports map), so the ViewHostContext identity matches.
      const { NodeViewHostProvider } = await import("beebox/view-widgets");
      const { renderToString } = await import("react-dom/server");
      for (const [index, current] of states.entries()) {
        state = current;
        const budgetMs = Math.max(0, Math.min(SETTLE_BUDGET_MS, (deadline - Date.now()) / (states.length - index)));
        const props = buildProps({ cards, files, params: current.params, boxSlug });
        stage = "first frame";
        renderToString(
          createElement(NodeViewHostProvider, { boxSlug, children: createElement(viewMod.default, props) }),
        );
        stage = "after effects";
        const settled = await settledRender({ boxRoot, View: viewMod.default, props, Host: NodeViewHostProvider, budgetMs });
        if (settled.error !== null) throw settled.error;
        if (settled.snapshot !== null) snapshots.push(snapshotOf(current.label, settled.snapshot));
        for (const remark of settled.partial) process.stdout.write(`${PARTIAL_PREFIX}${current.label}: ${remark}\n`);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const where = state === null ? "" : ` [${state.label}, ${stage}]`;
      process.stderr.write(`View render failed${where}: ${err.name}: ${err.message}\n`);
      if (err.stack) process.stderr.write(`${err.stack}\n`);
      return 1;
    }

    // Cards that matched a dependency glob but failed to load. The live app
    // omits them silently; the check surfaces them as author feedback.
    if (skipped.length > 0) {
      process.stderr.write(`\n${String(skipped.length)} card(s) selected by dependencies failed to load:\n`);
      for (const s of skipped) process.stderr.write(`  ${s.path}: ${s.error}\n`);
      if (!allowInvalidCards) {
        process.stderr.write("(pass --allow-invalid-cards to treat this as success)\n");
        return 1;
      }
    }
    // Only a passing view gets advice, so only it leaves a snapshot. Advice
    // never changes the result: a snapshot that cannot be written is a remark.
    if (options.snapshotPath !== undefined) {
      try {
        await fs.writeFile(options.snapshotPath, JSON.stringify(snapshots), { mode: 0o600 });
      } catch (e) {
        process.stdout.write(`${PARTIAL_PREFIX}${ADVICE_NOT_CHECKED}could not write the snapshot: ${errorMessage(e)}\n`);
      }
    }
    return 0;
  } finally {
    await mod.cleanup();
  }
}
