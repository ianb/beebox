// The live page (`cli page`): a nav of sketches, the chosen one mounted with its
// param panel, a frames-per-second readout from the surface's presents, one
// fixed-height line of what new picture versions cost, and every error kept on
// screen until reload. page-build.ts writes an entry that imports the sketches
// and calls `livePage`.
import { mountSketch } from "./mount.js";
import type { SceneFigure } from "./mount.js";

/** One sketch on the page; `key` is its `?s=` value. */
export interface LivePageEntry {
  readonly key: string;
  readonly label: string;
  readonly module: unknown;
}

/** How many picture keys the cost line names, most expensive first. */
const COST_KEYS = 3;

export function livePage(entries: readonly LivePageEntry[]): void {
  const query = new URLSearchParams(location.search);
  const chosen = entries.find((e) => e.key === query.get("s")) ?? entries[0];
  const nav = document.createElement("nav");
  for (const entry of entries) {
    query.set("s", entry.key);
    const a = document.createElement("a");
    a.href = `?${query.toString()}`;
    a.textContent = entry.label;
    if (entry === chosen) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  const fps = document.createElement("span");
  fps.className = "fps";
  fps.textContent = "starting…";
  const costs = document.createElement("div");
  costs.className = "costs";
  const errors = document.createElement("ul");
  errors.className = "errors";
  const host = document.createElement("main");
  nav.append(fps);
  document.body.append(nav, costs, errors, host);

  const keep = (what: string): void => {
    const li = document.createElement("li");
    li.textContent = what;
    errors.append(li);
  };
  addEventListener("error", (e) => keep(`error: ${e.message}`));
  addEventListener("unhandledrejection", (e) => keep(`unhandled rejection: ${String(e.reason)}`));
  if (chosen === undefined) {
    keep("no sketches on this page");
    return;
  }

  let figure: SceneFigure | undefined;
  let failed = false;
  try {
    mountSketch(host, {
      module: chosen.module,
      panel: true,
      onError: (e) => {
        failed = true;
        fps.textContent = "stopped";
        keep(`figure failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      },
      inspect: (f) => {
        figure = f;
      },
    });
  } catch (e) {
    keep(`mount failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return;
  }
  let last = { at: performance.now(), presents: 0 };
  setInterval(() => {
    if (figure === undefined || failed) return;
    const now = performance.now();
    const presents = figure.surface.presents;
    fps.textContent = `${(((presents - last.presents) * 1000) / (now - last.at)).toFixed(1)} frames/s`;
    last = { at: now, presents };
    const list = figure.surface.pictureCosts().toSorted((a, b) => b.recordMs + b.rasterMs - (a.recordMs + a.rasterMs));
    const ms = list.reduce((n, c) => n + c.recordMs + c.rasterMs, 0);
    costs.textContent =
      list.length === 0
        ? "new pictures: none"
        : `new pictures: ${ms.toFixed(0)} ms/s; ${list
            .slice(0, COST_KEYS)
            .map((c) => `${c.key} ×${String(c.versions)} ${(c.recordMs + c.rasterMs).toFixed(0)} ms`)
            .join(", ")}`;
  }, 1000);
}
