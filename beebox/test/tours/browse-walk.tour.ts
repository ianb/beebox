/**
 * Browse-walk: load the file tree, navigate down into a directory,
 * checkpoint at each step. Useful for catching list/tree a11y issues
 * and for visual review of dense data UI.
 *
 * Directory rows name their item count ("box directory, 791 items"), which is
 * box content — locators here match the directory name only.
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "browse-walk", description: "Open the browse tree, drill down into box/inbox, then into email/." },
  async (t) => {
    await t.go("/browse");
    await t.checkpoint("root");
    await t.expect.heading("Browse", { level: 1 });
    await t.expect.noPageErrors();

    await t.click({ role: "button", name: /^box directory/ });
    await t.checkpoint("box");
    await t.expect.noPageErrors();

    await t.go("/browse/box/inbox");
    await t.checkpoint("inbox");
    await t.expect.noPageErrors();

    await t.expect.button(/^email directory/);
  },
);
