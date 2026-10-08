/**
 * What the harness reads from inside the page: navigation timing, paints,
 * the app's first-load marks, and main-thread long tasks.
 *
 * Long tasks and LCP are only observable with a `PerformanceObserver` that
 * exists before they happen, so `OBSERVER_SCRIPT` is installed with
 * `Page.addScriptToEvaluateOnNewDocument` before navigation. All times are
 * milliseconds from navigation start.
 *
 * The observer also records two DOM milestones that need no app support, so
 * a build without the `bbx:*` marks (an older deploy) can still be measured:
 * `dom:mounted` (React replaced the boot fallback in `#root`) and
 * `dom:composer` (the "Compose message" region exists).
 */
import { z } from "zod";
import { FIRST_LOAD_MARKS } from "../../../shared/first-load-marks.js";
import type { CdpPage } from "./cdp.js";

export const OBSERVER_SCRIPT = `(() => {
  const store = { longTasks: [], lcp: undefined, dom: {} };
  window.__bbxPerfHarness = store;
  const checkDom = () => {
    const root = document.getElementById("root");
    if (store.dom["dom:mounted"] === undefined && root && !root.querySelector(".app-boot")) store.dom["dom:mounted"] = performance.now();
    if (store.dom["dom:composer"] === undefined && document.querySelector('section[aria-label="Compose message"]')) store.dom["dom:composer"] = performance.now();
  };
  new MutationObserver(checkDom).observe(document, { childList: true, subtree: true });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) store.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      store.lcp = entries[entries.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {
    console.warn("perf harness: observer unavailable", e);
  }
})();`;

const COLLECT_EXPRESSION = `(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const paints = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime]));
  const store = window.__bbxPerfHarness ?? { longTasks: [], lcp: undefined, dom: {} };
  const marks = { ...store.dom, ...Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("bbx:")).map((m) => [m.name, m.startTime])) };
  return {
    location: location.pathname,
    nav: nav ? { ttfb: nav.responseStart, responseEnd: nav.responseEnd, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd } : null,
    fcp: paints["first-contentful-paint"] ?? null,
    lcp: store.lcp ?? null,
    marks,
    longTasks: store.longTasks,
  };
})()`;

const collectedSchema = z.object({
  location: z.string(),
  nav: z.object({ ttfb: z.number(), responseEnd: z.number(), domContentLoaded: z.number(), load: z.number() }).nullable(),
  fcp: z.number().nullable(),
  lcp: z.number().nullable(),
  marks: z.record(z.string(), z.number()),
  longTasks: z.array(z.object({ start: z.number(), duration: z.number() })),
});

export interface PageMetrics {
  location: string;
  ttfbMs: number | undefined;
  domContentLoadedMs: number | undefined;
  loadMs: number | undefined;
  fcpMs: number | undefined;
  lcpMs: number | undefined;
  /** `bbx:*` first-load marks (src/shared/first-load-marks.ts). */
  marks: Record<string, number>;
  longTaskCount: number;
  longTaskMs: number;
  /** Sum of each long task's time over 50 ms (Lighthouse's TBT, unbounded by TTI). */
  blockingMs: number;
}

const round = (n: number | null | undefined): number | undefined => (n === null || n === undefined ? undefined : Math.round(n));

export async function collectPageMetrics(page: CdpPage): Promise<PageMetrics> {
  const c = await page.evaluate(COLLECT_EXPRESSION, collectedSchema);
  return {
    location: c.location,
    ttfbMs: round(c.nav?.ttfb),
    domContentLoadedMs: round(c.nav?.domContentLoaded),
    loadMs: round(c.nav?.load),
    fcpMs: round(c.fcp),
    lcpMs: round(c.lcp),
    marks: Object.fromEntries(Object.entries(c.marks).map(([k, v]) => [k, Math.round(v)])),
    longTaskCount: c.longTasks.length,
    longTaskMs: Math.round(c.longTasks.reduce((n, t) => n + t.duration, 0)),
    blockingMs: Math.round(c.longTasks.reduce((n, t) => n + Math.max(0, t.duration - 50), 0)),
  };
}

/**
 * Reads one milestone's time, or undefined before the page reaches it.
 * `dom:*` milestones come from the harness observer; others are app marks.
 */
export async function readMark(page: CdpPage, mark: string): Promise<number | undefined> {
  const name = JSON.stringify(mark);
  const expression = `(() => {
    const dom = window.__bbxPerfHarness?.dom?.[${name}];
    if (dom !== undefined) return dom;
    const m = performance.getEntriesByName(${name}, "mark")[0];
    return m ? m.startTime : null;
  })()`;
  return round(await page.evaluate(expression, z.number().nullable()).catch(() => null));
}

/** Whether the page's build records the app's first-load marks (older deploys do not). */
export async function hasAppMarks(page: CdpPage): Promise<boolean> {
  return (await readMark(page, FIRST_LOAD_MARKS.entry)) !== undefined;
}

/** The milestone a run waits for by default: the conversation's history has rendered. */
export const DEFAULT_UNTIL_MARK = FIRST_LOAD_MARKS.history;
