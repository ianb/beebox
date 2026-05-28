/**
 * Dashboard tour: load `/`, snapshot, then click through to Browse.
 * First tour written — primarily a smoke test of the tour-lib framework.
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "dashboard", description: "Walk the dashboard and follow Browse from the primary nav." },
  async (t) => {
    await t.go("/");
    await t.checkpoint("loaded");

    await t.expect.landmark("Primary");
    await t.expect.landmark("Schedules");
    await t.expect.button("+ Memo");

    await t.click({ role: "link", name: "Browse" });
    await t.checkpoint("after-nav-browse");

    await t.expect.heading("Browse", { level: 1 });
  },
);
