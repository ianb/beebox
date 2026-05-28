/**
 * Visit every link in the primary nav, checkpoint each. The cheapest way
 * to get a full-app a11y survey + screenshot set in one pass.
 */

import { tour } from "./tour-lib/index.js";

const PAGES = [
  { path: "/", label: "Dashboard" },
  { path: "/chat", label: "Recent" },
  { path: "/chats", label: "Chats" },
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
