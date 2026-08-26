/**
 * The "every page has its skeleton" sweep: visit every routed page and assert
 * the frame it should always render — the Primary nav landmark, the page's own
 * h1, and the regions that structure it — plus a screenshot/a11y capture per
 * page. The cheapest way to get a full-app a11y survey in one pass. Not every
 * page is reachable from the app bar any more (`docs/plans/top-nav-ia.md`) —
 * the list is the route set, not the menu.
 *
 * The `dashboard` tour was folded in here (retired 2026-08-26). Its extra value
 * was a click-through from the dashboard to Browse, and `bin/smoke` already
 * clicks /browse at every merge; what remains is the skeleton assertion, which
 * is this tour's job.
 *
 * Expectations must not be content-derived: an h1 or landmark listed here has
 * to hold on any box, not just one with these cards in it. (That is why
 * /dashboard has no `h1` — its heading is the box's name.)
 */

import { tour } from "./tour-lib/index.js";

interface Page {
  path: string;
  label: string;
  /** Level-1 heading, where the page has a box-independent one. */
  h1?: string;
  /** Landmark regions besides "Primary", which every page asserts. */
  landmarks: string[];
}

const PAGES: Page[] = [
  { path: "/chat", label: "Chat", h1: "Chat", landmarks: ["Compose message"] },
  { path: "/dashboard", label: "Dashboard", landmarks: ["Schedules", "Needs attention", "Recent activity"] },
  { path: "/questions", label: "Questions", h1: "Questions", landmarks: [] },
  // /news lands in chat on this box's nav (top-nav-ia).
  { path: "/news", label: "News", h1: "Chat", landmarks: ["Compose message"] },
  { path: "/browse", label: "Browse", h1: "Browse", landmarks: ["Browse"] },
  { path: "/landmarks", label: "Landmarks", h1: "Landmarks", landmarks: [] },
  // Mobile auto-selects a commit, so "Commit details" is the pane both
  // viewports share; the commit list region only exists at desktop width.
  { path: "/history", label: "History", landmarks: ["Commit details"] },
  { path: "/capture", label: "Capture", h1: "Capture", landmarks: ["Compose message"] },
  { path: "/settings", label: "Settings", h1: "Settings", landmarks: ["Password", "Scan uploaders"] },
  { path: "/admin", label: "Admin", h1: "Admin", landmarks: ["Allowed users", "Secrets"] },
];

tour(
  { name: "nav-pages", description: "Walk every routed page and assert each one renders its skeleton." },
  async (t) => {
    for (const page of PAGES) {
      await t.go(page.path);
      await t.checkpoint(page.label.toLowerCase());
      await t.expect.landmark("Primary");
      if (page.h1 !== undefined) await t.expect.heading(page.h1, { level: 1 });
      for (const landmark of page.landmarks) await t.expect.landmark(landmark);
      await t.expect.noPageErrors();
    }
  },
);
