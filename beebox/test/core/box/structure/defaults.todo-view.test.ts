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
import "agent-doctest/tap";
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
  // doctest:L31
  const box = await makeBox();
  const installed = await installTodoView(box);
  t.check(installed, true);

  // doctest:L36
  const content = await fs.readFile(path.join(box, "_content/plate.todo-view.card"), "utf-8");
  await t.checkText(content.includes('glob: "**"'), "true");

  // doctest:L42
  const versions = await readVersions(box);
  t.check(Object.keys(versions), [
    "_content/plate.todo-view.card",
  ]);

  // ## Re-running on an already-installed, untouched box is a no-op (`installed: false`)

  // doctest:L52
  const installedAgain = await installTodoView(box);
  t.check(installedAgain, false);
});

// ## `_content/plate.todo-view.card` is a recognized template-managed path
//
// So `bbx upgrade`/`syncTemplatesFromSource`'s selective commit step recognizes
// its writes as generated output rather than unrelated dirt:
void test("So bbx upgrade/syncTemplatesFromSource's selective commit step recognizes its...", async (t) => {
  // doctest:L67
  t.check(isTemplateManagedPath("_content/plate.todo-view.card"), true);

  // doctest:L70
  t.check(isTemplateManagedPath("_content/other.todo-view.card"), false);
});
