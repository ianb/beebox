// # bbx view render-one
//
// The hidden `bbx view render-one <slug>`, the per-view child `bbx view check`
// spawns, renders an agent-authored view in Node — in-process, no server — and
// exits 0, or on failure prints the error with a source-mapped stack to stderr.
// It loads the same cards the running app would pass the view. It prints no HTML.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
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
interface RenderOneResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runRenderOne(boxRoot: string, args: string[]): Promise<RenderOneResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PKG, "dist/cli.mjs"), "view", "render-one", ...args], { cwd: boxRoot });
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
// A view that renders off its `cards` prop renders and exits 0:
void test("A view that renders off its cards prop renders and exits 0:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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

  const r = await runRenderOne(box.root, ["count"]);
  t.check(r, {
    code: 0,
    stdout: "",
    stderr: "",
  });
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

  const r = await runRenderOne(box.root, ["prose"]);
  // The box slug in the link is the temp box's random directory name.
  t.check(r, {
    code: 0,
    stdout: "",
    stderr: "",
  });
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

  const r = await runRenderOne(box.root, ["image"]);
  t.check(r, {
    code: 0,
    stdout: "",
    stderr: "",
  });
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

  const r = await runRenderOne(box.root, ["boom"]);
  // The stack names the view source file; its other frames hold temp and install paths.
  t.check(r, {
    code: 1,
    stdout: "",
    stderr: str`View render failed: TypeError: Cannot read properties of undefined (reading 'map')
TypeError: Cannot read properties of undefined (reading 'map')
${any(String).includes("views/boom.tsx")}
`,
  });
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
  const box = await makeViewBox();
  await writeView(box, { rel: "topthrow.tsx", content: `
export const name = "TopThrow";
export const dependencies = [];
export const modes = ["page"];
const missing = undefined;
const boom = missing.value;
export default function TopThrow() { return <div>{boom}</div>; }
` });

  const r = await runRenderOne(box.root, ["topthrow"]);
  t.check(r, {
    code: 1,
    stdout: "",
    stderr: str`View render failed: TypeError: Cannot read properties of undefined (reading 'value')
TypeError: Cannot read properties of undefined (reading 'value')
${any(String).includes("views/topthrow.tsx")}
`,
  });
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

  const r = await runRenderOne(box.root, ["early"]);
  t.check(r, {
    code: 1,
    stdout: "",
    stderr: str`View render failed: ViewHelperDuringRenderError: readFile() was called during render — async helpers only run in effects/handlers, which 'bbx view check' does not execute (v1 renders the component body once).
ViewHelperDuringRenderError: readFile() was called during render — async helpers only run in effects/handlers, which 'bbx view check' does not execute (v1 renders the component body once).
${any(String)}
`,
  });
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
  const box = await makeViewBox();
  const r = await runRenderOne(box.root, ["ghost"]);
  t.check(r, {
    code: 1,
    stdout: "",
    stderr: str`Error: View not found: ghost (looked for ${any(String)}/src/views/ghost.tsx)
`,
  });
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
  const box = await makeViewBox();
  await box.write("_content/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema\n");
  await writeView(box, { rel: "list.tsx", content: `
export const name = "List";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function List({ cards }) { return <div>n: {cards.length}</div>; }
` });

  const r = await runRenderOne(box.root, ["list"]);
  const badCardStderr = str`
1 card(s) selected by dependencies failed to load:
  _content/inbox/Bad.bogus.card: ${any(String)}/_content/inbox/Bad.bogus.card: not a recognized card: no frontmatter block with a registered type
`;
  t.check(r, {
    code: 1,
    stdout: "",
    stderr: str`${badCardStderr}(pass --allow-invalid-cards to treat this as success)
`,
  });

  // With the flag it exits 0:

  const ok = await runRenderOne(box.root, ["list", "--allow-invalid-cards"]);
  t.check(ok, {
    code: 0,
    stdout: "",
    stderr: badCardStderr,
  });
});
