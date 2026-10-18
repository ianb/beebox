// # Views Compiler
//
// The views compiler takes agent-written `.tsx` files and compiles them to ES modules using esbuild. It extracts metadata from named exports and caches compiled output by mtime.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { compileView, listViews, buildErrorModule, invalidateView } from "../../../src/webapp/views/compiler/compile.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// ## Metadata extraction
//
// The compiler extracts name, description, dependencies, modes, layout, and rendersCardTypes from the view's named exports:
void test("The compiler extracts name, description, dependencies, modes, layout, and ren...", async (t) => {
  // doctest:L19
  const tmp = await mkdtemp(join(tmpdir(), "views-test-"));
  const viewsDir = join(tmp, "views");
  await mkdir(viewsDir, { recursive: true });

  // doctest:L23
  const source = `
export const name = "Test View";
export const description = "A simple test";
export const dependencies = ["_content/**/*.card", "_content/**/*.card"];
export const modes = ["page", "chat"];
export const layout = "full-bleed";
export const rendersCardTypes = ["sandbox"];
export default function Test() {
  return window.__bbxReact.createElement("div", null, "hello");
}
`;
  await writeFile(join(viewsDir, "test.tsx"), source);

  // doctest:L36
  const { meta } = await compileView(join(viewsDir, "test.tsx"));
  t.check(meta.name, "Test View");

  // doctest:L42
  t.check(meta.slug, "test");

  // doctest:L45
  t.check(meta.description, "A simple test");

  // doctest:L48
  t.check(meta.dependencies, [
    "_content/**/*.card",
    "_content/**/*.card",
  ]);

  // doctest:L51
  t.check(meta.rendersCardTypes, [
    "sandbox",
  ]);

  // doctest:L54
  t.check(meta.modes, [
    "page",
    "chat",
  ]);

  // doctest:L57
  t.check(meta.layout, "full-bleed");

  // ## Compilation output
  //
  // The compiled output is valid JavaScript with React externalized:

  // doctest:L66
  const { output } = await compileView(join(viewsDir, "test.tsx"));
  await t.checkText(output.includes("window.__bbxReact"), "true");

  // ## Caching
  //
  // Compiling the same file twice returns cached output (same mtime and size). To show the cache is used, the next example rewrites the source with same-length different text and restores the mtime, so only a cache can still return the old output:

  // doctest:L76
  const viewFile = join(viewsDir, "test.tsx");
  const pinned = new Date("2026-01-01T00:00:00Z");
  await utimes(viewFile, pinned, pinned);
  invalidateView(viewFile);
  const { output: pinnedOutput } = await compileView(viewFile);
  await writeFile(viewFile, source.replace('"hello"', '"HELLO"'));
  await utimes(viewFile, pinned, pinned);
  const { output: output2 } = await compileView(viewFile);
  await t.checkText(output2 === pinnedOutput, "true");

  // After invalidation, a fresh compile reads the rewritten source:

  // doctest:L91
  invalidateView(viewFile);
  const { output: output3 } = await compileView(viewFile);
  t.check([output3.includes("HELLO"), output3.includes("hello")], [
    true,
    false,
  ]);
});

// ## jsx-runtime shim translates the automatic runtime
//
// A view written with real JSX compiles against the `react/jsx-runtime` shim. The
// shim must translate `jsx`/`jsxs` (children carried *inside* props, `key` a
// separate arg) into `createElement` (children as rest args) — otherwise a
// static-children array reaches `createElement` as a single array child and React
// emits a spurious "unique key" dev warning for every multi-child view. The fix
// spreads the children array, so the compiled shim carries the `Array.isArray`
// translation rather than a naive `jsx = React.createElement` alias.
void test("A view written with real JSX compiles against the react/jsx-runtime shim.", async (t) => {
  // doctest:L108
  const jtmp = await mkdtemp(join(tmpdir(), "views-jsx-"));
  const jviews = join(jtmp, "views");
  await mkdir(jviews, { recursive: true });
  await writeFile(join(jviews, "multi.tsx"), `
export const name = "Multi";
export const modes = ["page"];
export default function Multi() {
  return <div><span>a</span><span>b</span></div>;
}
`);
  const { output: jsxOut } = await compileView(join(jviews, "multi.tsx"));
  await t.checkText(jsxOut.includes("Array.isArray(children)"), "true");

  // The naive alias that dropped `key` and passed array children whole is gone:

  // doctest:L126
  await t.checkText(jsxOut.includes("jsx = React.createElement"), "false");
});

// ## Compile targets
//
// A view written with real JSX compiles differently per target. The default
// "browser" target externalizes React to the `window.__bbxReact` shim; the "node"
// target externalizes React to bare specifiers, so a Node renderer resolves the
// real React from node_modules and shares one instance with `react-dom/server`:
void test("A view written with real JSX compiles differently per target.", async (t) => {
  // doctest:L138
  const tmpT = await mkdtemp(join(tmpdir(), "views-target-"));
  const viewsDirT = join(tmpT, "views");
  await mkdir(viewsDirT, { recursive: true });
  await writeFile(join(viewsDirT, "jsx.tsx"), `
export const name = "JSX View";
export const dependencies = [];
export const modes = ["page"];
export default function JsxView() {
  return <div>hello</div>;
}
`);
  const viewPathT = join(viewsDirT, "jsx.tsx");

  const browserBuild = await compileView(viewPathT, { target: "browser" });
  // doctest:L151
  await t.checkText(browserBuild.output.includes("window.__bbxReact"), "true");

  // The browser build never emits a bare `react/jsx-runtime` import; the node build
  // does (esbuild's automatic JSX import, left external):

  // doctest:L160
  t.check(/from\s*"react\/jsx-runtime"/.test(browserBuild.output), false);

  // doctest:L165
  const nodeBuild = await compileView(viewPathT, { target: "node" });
  t.check(/from\s*"react\/jsx-runtime"/.test(nodeBuild.output), true);

  // doctest:L171
  await t.checkText(nodeBuild.output.includes("window.__bbxReact"), "false");

  // The node build carries an inline source map for stack mapping:

  // doctest:L178
  await t.checkText(nodeBuild.output.includes("sourceMappingURL=data:application/json"), "true");

  // The two targets are cached independently — compiling one never returns the
  // other's output (no cross-contamination):

  // doctest:L186
  await t.checkText(nodeBuild.output === browserBuild.output, "false");
});

// ## Missing metadata defaults
//
// When metadata exports are missing, sensible defaults are used:
void test("When metadata exports are missing, sensible defaults are used:", async (t) => {
  // doctest:L195
  const tmp2 = await mkdtemp(join(tmpdir(), "views-test-"));
  const viewsDir2 = join(tmp2, "views");
  await mkdir(viewsDir2, { recursive: true });

  // doctest:L199
  const minimal = `
export default function Minimal() {
  return window.__bbxReact.createElement("div", null, "minimal");
}
`;
  await writeFile(join(viewsDir2, "minimal.tsx"), minimal);

  // doctest:L206
  const { meta } = await compileView(join(viewsDir2, "minimal.tsx"));
  t.check(meta.name, "minimal");

  // doctest:L212
  t.check(meta.slug, "minimal");

  // doctest:L215
  t.check(meta.description, "");

  // doctest:L218
  t.check(meta.dependencies, []);

  // doctest:L221
  t.check(meta.layout, "inset");

  // An unknown `layout` fails validation. The view degrades like a broken one,
  // and the marker names the export, so the author can see what to fix:

  // doctest:L229
  await writeFile(join(viewsDir2, "wide.tsx"), `
export const layout = "wide";
export const rendersCardTypes = ["sandbox"];
export default function Wide() {
  return window.__bbxReact.createElement("div", null, "wide");
}
`);
  const wide = (await compileView(join(viewsDir2, "wide.tsx"))).meta;
  t.check([wide.rendersCardTypes, wide.layout], [
    [],
    "inset",
  ]);

  // doctest:L240
  await t.checkText(wide.description.startsWith("Invalid metadata export layout:"), "true");
});

// ## Error module
//
// When compilation fails, `buildErrorModule` creates a valid JS module that renders the error:
void test("When compilation fails, buildErrorModule creates a valid JS module that rende...", async (t) => {
  // doctest:L249
  const errorJs = buildErrorModule("Unexpected token at line 5");
  await t.checkText(errorJs.includes("Compile error"), "false");

  // doctest:L253
  await t.checkText(errorJs.includes("Unexpected token at line 5"), "true");
});

// ## Listing views
//
// `listViews` resolves the views directory from the box's shape (via
// `getBoxShape`/`boxCodePaths`), so it needs a real box — its views
// directory is `<boxRoot>/src/views`:
void test("listViews resolves the views directory from the box's shape (via getBoxShape/...", async (t) => {
  // doctest:L264
  const box3 = await makeTmpBox({ deps: true });
  const tmp3 = box3.root;

  // doctest:L267
  // No views/ directory — returns empty
  const empty = await listViews(tmp3);
  await t.checkText(empty.length, "0");

  // doctest:L274
  const viewsDir3 = join(box3.root, "src/views");
  await mkdir(viewsDir3, { recursive: true });

  // doctest:L277
  await writeFile(join(viewsDir3, "dashboard.tsx"), `
export const name = "Dashboard";
export const description = "Overview dashboard";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function Dashboard() {
  return window.__bbxReact.createElement("div", null, "dash");
}
`);

  await writeFile(join(viewsDir3, "summary.tsx"), `
export const name = "Summary";
export const description = "Quick summary";
export const dependencies = [];
export const modes = ["chat"];
export default function Summary() {
  return window.__bbxReact.createElement("div", null, "sum");
}
`);

  const views = await listViews(tmp3);
  // doctest:L287
  // doctest:L297
  await t.checkText(views.length, "2");

  // doctest:L303
  const names = views.map(v => v.name).toSorted();
  t.check(names, [
    "Dashboard",
    "Summary",
  ]);

  // A view that fails to compile still appears in the listing — degraded to its
  // filename and a `description: "Failed to compile"` marker — rather than
  // silently vanishing. Metadata now comes from importing the real module, so a
  // view that can't even compile has no metadata to import; `rendersCardTypes`
  // degrades to empty rather than being preserved (unlike the old regex fallback):

  // doctest:L315
  await writeFile(join(viewsDir3, "broken.tsx"), `
export const name = "Broken View";
export const rendersCardTypes = ["broken-type"];
export default function Broken() {
  const x = ;
  return null;
}
`);

  const withBroken = await listViews(tmp3);
  const broken = withBroken.find(v => v.slug === "broken");
  // doctest:L324
  t.check([broken?.name, broken?.rendersCardTypes, broken?.description], [
    "broken",
    [],
    "Failed to compile",
  ]);
});
