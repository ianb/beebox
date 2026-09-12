/**
 * The "every page has its skeleton" sweep: visit every routed page and assert
 * the frame it should always render — the Primary nav landmark, the card's own
 * heading, and the regions that structure it — plus a screenshot/a11y capture per
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
 * to hold on any box. Instruments use their canonical card headings; the
 * shared workspace owns the level-one heading.
 */

import { tour } from "./tour-lib/index.js";

interface Page {
  path: string;
  label: string;
  target?: string;
  heading?: { name: string; level: number };
  button?: string | RegExp;
  /** Landmark regions besides "Primary", which every page asserts. */
  landmarks: string[];
}

const PAGES: Page[] = [
  { path: "/chat", label: "Chat", landmarks: ["Compose message"] },
  { path: "/dashboard", label: "Dashboard", target: "_config/interface/dashboard.card", heading: { name: "Dashboard", level: 2 }, landmarks: ["Schedules", "Needs attention", "Recent activity"] },
  { path: "/questions", label: "Questions", target: "_config/interface/questions.card", heading: { name: "Questions", level: 2 }, landmarks: [] },
  // /news lands in chat on this box's nav (top-nav-ia).
  { path: "/news", label: "News", landmarks: ["Compose message"] },
  { path: "/browse", label: "Browse", target: "_config/interface/browse.card", heading: { name: "Browse", level: 2 }, landmarks: ["Browse"] },
  { path: "/landmarks", label: "Landmarks", target: "_config/interface/landmarks.card", heading: { name: "Landmarks", level: 2 }, landmarks: [] },
  // Mobile auto-selects a commit, so "Commit details" is the pane both
  // viewports share; the commit list region only exists at desktop width.
  { path: "/history", label: "History", target: "_config/interface/history.card", heading: { name: "History", level: 2 }, landmarks: ["Commit details"] },
  { path: "/inventory", label: "Storage", target: "_config/interface/inventory.card", heading: { name: "Storage", level: 2 }, landmarks: ["Storage summary", "Storage area view"] },
  { path: "/settings", label: "Settings", target: "_config/interface/settings.card", heading: { name: "Settings", level: 2 }, landmarks: ["Password", "Scan uploaders"] },
  { path: "/admin", label: "Admin", target: "_config/interface/admin.card", heading: { name: "Admin", level: 2 }, landmarks: ["Allowed users", "Secrets"] },
  { path: "/capture?session=new&engine=codex", label: "Capture", button: /^(Exit capture|Discard and exit capture)$/, landmarks: [] },
];

tour(
  { name: "nav-pages", description: "Walk every routed page and assert each one renders its skeleton." },
  async (t) => {
    for (const page of PAGES) {
      await t.go(page.path);
      await t.checkpoint(page.label.toLowerCase());
      await t.expect.landmark("Primary");
      if (page.target !== undefined) {
        const target = await t.eval("new URL(location.href).searchParams.get('card')?.split('?')[0] ?? null");
        await t.expect.custom(`${page.label} alias projects its canonical card`, () => target.trim().replace(/^"|"$/g, "") === page.target);
      }
      if (page.heading !== undefined) await t.expect.heading(page.heading.name, { level: page.heading.level });
      if (page.button !== undefined) await t.expect.button(page.button);
      for (const landmark of page.landmarks) await t.expect.landmark(landmark);
      await t.expect.noPageErrors();
    }
  },
);
