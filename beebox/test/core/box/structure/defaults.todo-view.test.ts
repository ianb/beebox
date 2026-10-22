// # `installTodoView` — the box-wide `todo-view` stock instance
//
// `docs/implemented-plans/todo-annotation.md` Track 4 pins the box-wide plate as
// **provisioned, not just templated**: `_content/plate.todo-view.card`, explicit
// `glob: "**"`, installed by `bbx init`'s stock-template pass
// (`installTodoView`, `src/core/box/structure/defaults.ts`) and tracked in
// `_config/template-versions.json` exactly like the other `installTemplateFile`-backed
// stock cards (procedures, guides, personality, briefing, root landmark) —
// same mechanism, same `fresh`/`unchanged` idempotence, no bespoke seeding path.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installTodoView } from "../../../../src/core/box/structure/core.js";
import { isTemplateManagedPath } from "../../../../src/core/install-template-file.js";

async function makeBox() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-install-todo-view-"));
}

async function readVersions(box: string) {
  const text = await fs.readFile(path.join(box, "_config/template-versions.json"), "utf-8");
  return JSON.parse(text);
}

// ## Fresh box: installs `_content/plate.todo-view.card` with `glob: "**"`, and records it in the tracker
void test("Fresh box: installs `_content/plate.todo-view.card` with `glob: \"**\"`, and records it in the tracker", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeBox();
  const installed = await installTodoView(box);
  t.check(installed, true);

  const content = await fs.readFile(path.join(box, "_content/plate.todo-view.card"), "utf-8");
  t.check(content, `---
title: Todos
glob: "**"
---
`);

  const versions = await readVersions(box);
  t.check(versions, {
    "_content/plate.todo-view.card": {
      sha256: "1225ed2082487191bb6596ffd1a672c9db460593317c86d06cd71854dd6a7758",
      "installed-at": isoDate(),
      stock: `---
title: Todos
glob: "**"
---
`,
    },
  });

  // ## Re-running on an already-installed, untouched box is a no-op (`installed: false`)

  const installedAgain = await installTodoView(box);
  t.check(installedAgain, false);
});

// ## `_content/plate.todo-view.card` is a recognized template-managed path
//
// So `bbx upgrade`/`syncTemplatesFromSource`'s selective commit step recognizes
// its writes as generated output rather than unrelated dirt:
void test("So bbx upgrade/syncTemplatesFromSource's selective commit step recognizes its...", async (t) => {
  t.check(isTemplateManagedPath("_content/plate.todo-view.card"), true);

  t.check(isTemplateManagedPath("_content/other.todo-view.card"), false);
});
