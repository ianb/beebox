// # bbx view test
//
// `bbx view test <slug>` renders an agent-authored view in Node — in-process, no
// server — and prints the output, or on failure the error with a source-mapped
// stack. It loads the same cards the running app would pass the view.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import { spawn } from "node:child_process";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";

const PKG = process.cwd();
const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

// A v2 box renders views by resolving react from its OWN `node_modules`.
// `makeTmpBox({ deps: true, git: true })` only symlinks `beebox`, so simulate a
// real box's `react` dependency by symlinking the engine's copy beside it.
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

// Run the prebuilt CLI with the box as cwd (requireBoxRoot walks up from there).
interface ViewTestResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runViewTest(boxRoot: string, args: string[]): Promise<ViewTestResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PKG, "dist/cli.mjs"), "view", "test", ...args], { cwd: boxRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const DOC_CARD = `---
title: Note
sources: []
---
Body
`;

// ## Happy path — renders real cards
//
// A view that renders off its `cards` prop produces HTML and exits 0:
void test("A view that renders off its cards prop produces HTML and exits 0:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L66
  const box = await makeViewBox();
  await box.write("_content/inbox/A.doc.card", DOC_CARD);
  await box.write("_content/inbox/B.doc.card", DOC_CARD);
  await writeView(box, { rel: "count.tsx", content: `
export const name = "Count";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function Count({ cards }) {
  return <div>{"cards: " + cards.length}</div>;
}
` });

  const r = await runViewTest(box.root, ["count"]);
  // doctest:L78
  t.check(r.code, 0);

  // doctest:L84
  await t.checkText(r.stdout.includes("cards: 2"), "true");
});

// ## Card text through `Markdown`
//
// A view renders a card's body with `Markdown` from `beebox/view-widgets`, the
// app's own renderer (`docs/plans/todos-ui.md`, Track 6). It renders here with
// no app router: the node view host supplies the box slug. A relative link
// resolves against the card, and a todo carries the collector's locator (file
// line 7: four frontmatter lines, then the body's third line):
void test("A view renders a card's body with Markdown from beebox/view-widgets, the app'...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L101
  const box = await makeViewBox();
  await box.write("_content/inbox/A.doc.card", DOC_CARD.replace("Body\n", "See [B](B.doc.card).\n\n{% todo %}Order lumber{% /todo %}\n"));
  await writeView(box, { rel: "prose.tsx", content: `
import { Markdown } from "beebox/view-widgets";
export const name = "Prose";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function Prose({ cards }) {
  return <div>{cards.map((card) => card.body ? <Markdown key={card.path} card={card}>{card.body}</Markdown> : null)}</div>;
}
` });

  const r = await runViewTest(box.root, ["prose"]);
  // doctest:L113
  t.check([r.code, r.stdout.includes("/views/_content/inbox/B.doc.card"), r.stdout.includes('data-todo-locator="7"')].join(" "), "0 true true");
});

// ## Image variants are safe to construct during render
//
// The mock exposes the same synchronous `imageUrl` helper as the browser host,
// including URL-encoded options and a separate original `fileUrl`.
void test("The mock exposes the same synchronous imageUrl helper as the browser host, in...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L128
  const box = await makeViewBox();
  await writeView(box, { rel: "image.tsx", content: `
export const name = "Image";
export const dependencies = [];
export const modes = ["page"];
export default function Image({ imageUrl, fileUrl }) {
  const path = "store/Trip.attach/beach photo.jpg";
  return <a href={fileUrl(path)}><img src={imageUrl(path, { width: 480, format: "auto" })} /></a>;
}
` });

  const r = await runViewTest(box.root, ["image"]);
  // doctest:L139
  t.check([r.code, r.stdout.includes("/api/images/store/Trip.attach/beach photo.jpg?width=480&amp;format=auto"), r.stdout.includes("/api/files/store/Trip.attach/beach photo.jpg")].join(" "), "0 true true");
});

// ## Render failure — source-mapped stack
//
// A view that throws during render exits 1 with the error and a stack that maps
// back to the `.tsx` source (not the compiled output):
void test("A view that throws during render exits 1 with the error and a stack that maps...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L154
  const box = await makeViewBox();
  await writeView(box, { rel: "boom.tsx", content: `
export const name = "Boom";
export const dependencies = [];
export const modes = ["page"];
export default function Boom() {
  const items = undefined;
  return <ul>{items.map((x) => <li>{x}</li>)}</ul>;
}
` });

  const r = await runViewTest(box.root, ["boom"]);
  // doctest:L165
  t.check(r.code, 1);

  // doctest:L171
  await t.checkText(r.stderr.includes("View render failed"), "true");

  // The stack names the view source file:

  // doctest:L178
  await t.checkText(r.stderr.includes("views/boom.tsx"), "true");
});

// ## Top-level (module-eval) failure — also source-mapped
//
// A view that throws while the module evaluates (not in the component body) gets
// the same source-mapped diagnostics — the import shares the render's error block:
void test("A view that throws while the module evaluates (not in the component body) get...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L192
  const box = await makeViewBox();
  await writeView(box, { rel: "topthrow.tsx", content: `
export const name = "TopThrow";
export const dependencies = [];
export const modes = ["page"];
const missing = undefined;
const boom = missing.value;
export default function TopThrow() { return <div>{boom}</div>; }
` });

  const r = await runViewTest(box.root, ["topthrow"]);
  // doctest:L202
  t.check(r.code, 1);

  // doctest:L208
  await t.checkText(r.stderr.includes("View render failed"), "true");

  // doctest:L211
  await t.checkText(r.stderr.includes("views/topthrow.tsx"), "true");
});

// ## Async helper called during render throws
//
// `fileUrl` is fine in render, but the async helpers (`readFile`, `writeFile`,
// `adapterFetch`, …) throw a clear error if called during render — that's a view
// bug v1 surfaces rather than silently returning empty:
void test("fileUrl is fine in render, but the async helpers (readFile, writeFile, adapte...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L226
  const box = await makeViewBox();
  await writeView(box, { rel: "early.tsx", content: `
export const name = "Early";
export const dependencies = [];
export const modes = ["page"];
export default function Early({ readFile, fileUrl }) {
  readFile("_content/x.txt");
  return <img src={fileUrl("_content/y.png")} />;
}
` });

  const r = await runViewTest(box.root, ["early"]);
  // doctest:L237
  t.check(r.code, 1);

  // doctest:L243
  await t.checkText(r.stderr.includes("readFile() was called during render"), "true");
});

// ## Nonexistent view
void test("Nonexistent view", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L254
  const box = await makeViewBox();
  const r = await runViewTest(box.root, ["ghost"]);
  t.check(r.code, 1);

  // doctest:L261
  await t.checkText(r.stderr.includes("View not found: ghost"), "true");
});

// ## --path warns when the card isn't selected
//
// `--path` sets `params.path`; if the path isn't among the view's selected cards,
// the command warns (but still renders):
void test("--path sets params.path; if the path isn't among the view's selected cards, t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L275
  const box = await makeViewBox();
  await writeView(box, { rel: "page.tsx", content: `
export const name = "Page";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function Page({ params, viewHistory }) {
  return <div>{"path: " + (params.path || "none") + "; canPush: " + viewHistory.canPush}</div>;
}
` });

  const r = await runViewTest(box.root, ["page", "--path", "_content/inbox/Nope.doc.card"]);
  // doctest:L285
  t.check(r.code, 0);

  // doctest:L291
  await t.checkText(r.stderr.includes("is not among"), "true");

  // doctest:L294
  await t.checkText(r.stdout.includes("path: _content/inbox/Nope.doc.card"), "true");

  // doctest:L297
  await t.checkText(r.stdout.includes("canPush: false"), "true");
});

// ## Invalid selected card — diagnostics and non-zero exit
//
// When a dependency glob selects a card that fails to load, the command renders,
// reports it, and exits non-zero unless `--allow-invalid-cards`:
void test("When a dependency glob selects a card that fails to load, the command renders...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L311
  const box = await makeViewBox();
  await box.write("_content/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema\n");
  await writeView(box, { rel: "list.tsx", content: `
export const name = "List";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function List({ cards }) { return <div>n: {cards.length}</div>; }
` });

  const r = await runViewTest(box.root, ["list"]);
  // doctest:L320
  t.check(r.code, 1);

  // doctest:L326
  await t.checkText(r.stderr.includes("Bad.bogus.card"), "true");

  // With the flag it exits 0:

  // doctest:L333
  const ok = await runViewTest(box.root, ["list", "--allow-invalid-cards"]);
  t.check(ok.code, 0);
});
