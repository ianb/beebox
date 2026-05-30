/**
 * Browse-walk: load the file tree, navigate down into a directory,
 * checkpoint at each step. Useful for catching list/tree a11y issues
 * and for visual review of dense data UI.
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "browse-walk", description: "Open the browse tree, drill down into box/inbox, then into email/." },
  async (t) => {
    await t.go("/browse");
    await t.checkpoint("root");
    await t.expect.heading("Browse", { level: 1 });

    await t.click({ role: "button", name: "box directory, 3357 items" });
    await t.checkpoint("box");

    await t.go("/browse/box/inbox");
    await t.checkpoint("inbox");

    await t.expect.button("email directory, 2638 items");
  },
);
