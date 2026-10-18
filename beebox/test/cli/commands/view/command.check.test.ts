// # Checking all views in a box
//
// `checkViews(boxRoot, { timeoutMs })` renders every view in a box (each in a
// killable `bbx view test` child) and reports which fail. It's the whole-box gate a
// migration uses (`bbx view check`) and the broken-view detector. `ok` is true only
// when every view renders.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import { checkViews } from "../../../../src/cli/commands/view/command.js";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";

const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

// This test verifies render correctness, not the production timeout threshold.
// Full-suite contention has pushed a valid cold render past 40 seconds, so keep
// enough headroom here while the outer doctest timeout still catches hangs.
const TEST_VIEW_TIMEOUT_MS = 60000;

// A v2 box carries its own physical React copy. The renderer overrides it
// with the engine's copy so hook-using views share react-dom/server's
// dispatcher. `makeTmpBox({ deps: true, git: true })` therefore simulates the normal
// package layout by placing React beside the symlinked `beebox` package.
async function makeViewBox() {
  const box = await makeTmpBox({ deps: true, git: true });
  const reactNodeModules = dirname(dirname(requireFromEngine.resolve("react/package.json")));
  await symlink(join(reactNodeModules, "react"), join(box.root, "node_modules", "react"), "dir");
  return box;
}

// Views live at `<boxRoot>/src/views`.
async function writeView(box: TmpBox, { rel, content }: { rel: string; content: string }) {
  const full = join(box.root, "src", "views", rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

const DOC_CARD = `---
title: Test
---
Test doc content
`;

const GOOD_VIEW = `export const name = "Good";
export const description = "renders fine";
export const dependencies = [];
export const modes = ["page"];
export default function Good() {
  return <div>ok</div>;
}
`;

// Reads card.attrs (removed from ViewCard) — card.attrs is undefined, so
// card.attrs.title throws at render. This is exactly the breakage the
// view-card-shape migration exists to find and fix.
const BROKEN_VIEW = `export const name = "Broken";
export const description = "reads a removed field";
export const dependencies = ["_content/**/*.doc.card"];
export const modes = ["page"];
export default function Broken({ cards }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.attrs.title}</li>)}</ul>;
}
`;

// ## A mix of good and broken views fails, and names which
void test("A mix of good and broken views fails, and names which", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L72
  const box = await makeViewBox();
  await writeView(box, { rel: "good.tsx", content: GOOD_VIEW });
  await writeView(box, { rel: "broken.tsx", content: BROKEN_VIEW });
  await box.write("_content/inbox/Test.doc.card", DOC_CARD);

  // doctest:L77
  const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
  t.check(result.ok, false);

  // doctest:L81
  t.check(result.views.find((v) => v.slug === "good")?.ok, true);

  // doctest:L84
  t.check(result.views.find((v) => v.slug === "broken")?.ok, false);

  // doctest:L87
  await t.checkText((result.views.find((v) => v.slug === "broken")?.error ?? "").length > 0, "true");
});

// ## A box with no broken views passes
void test("A box with no broken views passes", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L98
  const box = await makeViewBox();
  await writeView(box, { rel: "good.tsx", content: GOOD_VIEW });

  // doctest:L101
  const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
  t.check(result.ok, true);

  // doctest:L105
  await t.checkText(result.views.length, "1");
});

// ## A box with no views at all is trivially OK
void test("A box with no views at all is trivially OK", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L116
  const box = await makeTmpBox();
  const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
  t.check(result, {
    ok: true,
    views: [],
  });
});

// </content>
