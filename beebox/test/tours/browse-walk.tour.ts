/**
 * Browse-walk: load the file tree, navigate down into a directory,
 * checkpoint at each step. Useful for catching list/tree a11y issues
 * and for visual review of dense data UI.
 *
 * Directory rows name their item count ("Content directory, 791 items"), which
 * is box content — locators here match the directory name only. The content
 * root is `_content/`, which Browse labels "Content".
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "browse-walk", description: "Open the browse tree, drill down into _content/inbox, then into email/." },
  async (t) => {
    await t.go("/browse");
    await t.checkpoint("root");
    await t.expect.heading("Browse", { level: 2 });
    await t.expect.noPageErrors();

    await t.click({ role: "button", name: /^Content directory/ });
    await t.checkpoint("content");
    await t.expect.heading("Browse", { level: 2 });
    await t.expect.noPageErrors();

    await t.go("/browse/_content/inbox");
    await t.checkpoint("inbox");
    await t.expect.heading("Browse", { level: 2 });
    await t.expect.noPageErrors();

    await t.expect.button(/^email directory/);
  },
);
