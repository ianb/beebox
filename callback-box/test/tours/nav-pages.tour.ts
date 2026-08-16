/**
 * Visit every routed page, checkpoint each. The cheapest way to get a
 * full-app a11y survey + screenshot set in one pass. Not every page is
 * reachable from the app bar any more (`docs/plans/top-nav-ia.md`) — the
 * list is the route set, not the menu.
 */

import { tour } from "./tour-lib/index.js";

const PAGES = [
  { path: "/chat", label: "Chat" },
  { path: "/dashboard", label: "Dashboard" },
  { path: "/questions", label: "Questions" },
  { path: "/news", label: "News" },
  { path: "/browse", label: "Browse" },
  { path: "/landmarks", label: "Landmarks" },
  { path: "/history", label: "History" },
  { path: "/capture", label: "Capture" },
  { path: "/settings", label: "Settings" },
  { path: "/admin", label: "Admin" },
];

tour(
  { name: "nav-pages", description: "Walk every routed page in the primary nav and capture artifacts." },
  async (t) => {
    for (const page of PAGES) {
      await t.go(page.path);
      await t.checkpoint(page.label.toLowerCase());
      await t.expect.landmark("Primary");
    }
  },
);
