/**
 * The settled render of `bbx view check` (docs/implemented-plans/view-check-settled-render.md,
 * Track 1): render a view in a jsdom document with `react-dom/client`, run its
 * effects, answer `readFile` from the box, and step until no helper call is
 * pending or the settle budget ends. A view that loads its data in an effect
 * and then throws fails here; the first-frame render shows only its loading
 * state.
 *
 * Runs only in the `bbx view render-one` child: it installs DOM globals on
 * the process.
 */

import { promises as fs } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { act, Component, createElement, type ComponentType, type ReactNode } from "react";
import type { ViewFile, ViewProps } from "../../../core/views/types.js";
import { resolveBoxNamespacePathOnDisk } from "../../../lib/box-namespace-resolve.js";
import { parseByteRange, viewReadRangeHeader } from "../../../shared/byte-range.js";

/** The most the settled render of one state waits for pending helper calls. */
export const SETTLE_BUDGET_MS = 5_000;
const TICK_MS = 10;
/**
 * How long no helper call may be pending before the render counts as settled.
 * Longer than one tick, so a read an effect starts from a short timer is
 * still seen; a read started later than this is not.
 */
const QUIET_MS = 250;

class AdapterFetchInCheckError extends Error {
  constructor() {
    super("adapterFetch() is not called by 'bbx view check'; the view sees this rejection instead");
    this.name = "AdapterFetchInCheckError";
  }
}

class PathOutsideBoxError extends Error {
  constructor(filePath: string) {
    super(`readFile: ${filePath} is not a box content path`);
    this.name = "PathOutsideBoxError";
  }
}

class RangeNotSatisfiableError extends Error {
  constructor(filePath: string) {
    super(`readFile: the byte range asked of ${filePath} is past its end (the app gets HTTP 416)`);
    this.name = "RangeNotSatisfiableError";
  }
}

let dom: JSDOM | null = null;

/** Install a jsdom window as the process's DOM globals, once. */
function installDom(): JSDOM {
  if (dom !== null) return dom;
  // Uncaught errors inside jsdom reach the error boundary or are the view's
  // own; the virtual console keeps jsdom from printing them a second time.
  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  // Copy the window's names that Node lacks (HTMLElement, Node, …); keep
  // Node's own (setTimeout, URL, fetch).
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (name in globalThis || name.startsWith("_")) continue;
    Reflect.set(globalThis, name, Reflect.get(dom.window, name));
  }
  Reflect.set(globalThis, "window", dom.window);
  Reflect.set(globalThis, "document", dom.window.document);
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  return dom;
}

/**
 * Read a box file as the app's `readFile` does (`useViewFileHelpers.ts`): the
 * same namespace policy as a view's dependency files, and the file route's
 * HTTP byte-range rule (`shared/byte-range.ts`).
 */
async function readBoxFile({ boxRoot, filePath, opts }: { boxRoot: string; filePath: string; opts: { start?: number; end?: number } | undefined }): Promise<string> {
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: filePath, mode: "read" });
  if (!ns.ok) throw new PathOutsideBoxError(filePath);
  const bytes = await fs.readFile(ns.resolved);
  const header = viewReadRangeHeader(opts);
  const range = header === null ? null : parseByteRange(header, bytes.length);
  // The route answers an unsatisfiable range with 416, and the app's readFile rejects.
  if (range === "unsatisfiable") throw new RangeNotSatisfiableError(filePath);
  return (range === null ? bytes : bytes.subarray(range.start, range.end + 1)).toString("utf-8");
}

interface BoundaryState { error: Error | null }

/** A settled render's DOM: the container's HTML and the `<style>` elements in the head. */
export interface SettledDom {
  html: string;
  headStyles: string[];
}

/** Records the first error a render or an effect throws. */
class CheckBoundary extends Component<{ children: ReactNode; onError: (e: Error) => void }, BoundaryState> {
  override state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  override componentDidCatch(error: unknown): void {
    this.props.onError(error instanceof Error ? error : new Error(String(error)));
  }
  override render(): ReactNode {
    return this.state.error === null ? this.props.children : null;
  }
}

/**
 * Render `View` with `props` until it settles. The async helpers are answered
 * here: `readFile` from the box; writes are not performed and resolve as if
 * they were; `commitFile` commits nothing; `adapterFetch` rejects. A render
 * with no error also returns its settled DOM, for `bbx view check` advice.
 */
export async function settledRender(opts: {
  boxRoot: string;
  View: ComponentType<ViewProps>;
  props: ViewProps;
  Host: ComponentType<{ boxSlug?: string; children: ReactNode }>;
  budgetMs?: number;
}): Promise<{ error: Error | null; partial: string[]; snapshot: SettledDom | null }> {
  const { boxRoot, View, Host } = opts;
  const budgetMs = opts.budgetMs ?? SETTLE_BUDGET_MS;
  const window = installDom().window;
  const { createRoot } = await import("react-dom/client");
  let pending = 0;
  let writes = 0;
  const track = <T,>(work: () => Promise<T>): Promise<T> => {
    pending += 1;
    return work().finally(() => { pending -= 1; });
  };
  const notPerformed = (filePath: string, content: string): Promise<ViewFile> => {
    writes += 1;
    return Promise.resolve({ path: filePath, size: Buffer.byteLength(content), mtimeMs: Date.now(), etag: "view-check" });
  };
  const props: ViewProps = {
    ...opts.props,
    readFile: (filePath, readOpts) => track(() => readBoxFile({ boxRoot, filePath, opts: readOpts })),
    writeFile: (filePath, { content }) => notPerformed(filePath, content),
    appendFile: (filePath, { content }) => notPerformed(filePath, content),
    commitFile: () => Promise.resolve({ committed: false }),
    adapterFetch: () => Promise.reject(new AdapterFetchInCheckError()),
  };

  // A holder, not a `let`: the boundary sets it from a callback.
  const caught: { error: Error | null } = { error: null };
  const onError = (e: Error) => { caught.error ??= e; };
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  // React logs every caught error and act warning to the console; the check
  // reports the error itself, so the console is quiet while the view runs.
  const { error: consoleError, warn: consoleWarn } = console;
  console.error = () => {};
  console.warn = () => {};
  // An error the view leaves uncaught outside React (a rejected readFile with
  // no catch, a throw in a timer) is a console error in the browser, not a
  // crash: record it, and do not let it end the process.
  const uncaught: string[] = [];
  const onUncaught = (e: unknown) => { uncaught.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e)); };
  process.on("unhandledRejection", onUncaught);
  process.on("uncaughtException", onUncaught);
  let settled = false;
  let snapshot: SettledDom | null = null;
  try {
    await act(async () => {
      const view = createElement(Host, { boxSlug: props.boxSlug, children: createElement(View, props) });
      root.render(createElement(CheckBoundary, { onError, children: view }));
    });
    const deadline = Date.now() + budgetMs;
    let quietSince = Date.now();
    while (caught.error === null && Date.now() < deadline) {
      await act(() => new Promise<void>((resolve) => { setTimeout(resolve, TICK_MS); }));
      if (pending > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= QUIET_MS) { settled = true; break; }
    }
    // What the advice rules read; serialized here, judged in the advise child.
    if (caught.error === null) {
      snapshot = { html: container.innerHTML, headStyles: [...window.document.head.querySelectorAll("style")].map((s) => s.outerHTML) };
    }
    await act(async () => { root.unmount(); });
  } finally {
    process.off("unhandledRejection", onUncaught);
    process.off("uncaughtException", onUncaught);
    console.error = consoleError;
    console.warn = consoleWarn;
    container.remove();
  }
  // A state still loading, or one that wrote (the check writes nothing, so
  // what the view shows next is not what the app would show), was not fully
  // checked.
  const partial: string[] = [];
  if (caught.error === null && !settled) partial.push(`still loading after ${(budgetMs / 1000).toFixed(1)}s`);
  if (writes > 0) partial.push(`${String(writes)} write${writes === 1 ? "" : "s"} not performed`);
  for (const message of new Set(uncaught)) partial.push(`uncaught outside render: ${message}`);
  return { error: caught.error, partial, snapshot };
}
