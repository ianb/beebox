// # Views Compiler
//
// The views compiler takes agent-written `.tsx` files and compiles them to ES modules using esbuild. It extracts metadata from named exports and caches compiled output by mtime.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not } from "@ianbicking/tap-check/check";
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
  const tmp = await mkdtemp(join(tmpdir(), "views-test-"));
  const viewsDir = join(tmp, "views");
  await mkdir(viewsDir, { recursive: true });

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

  const { meta } = await compileView(join(viewsDir, "test.tsx"));
  t.check(meta, {
    name: "Test View",
    slug: "test",
    description: "A simple test",
    dependencies: ["_content/**/*.card", "_content/**/*.card"],
    modes: ["page", "chat"],
    layout: "full-bleed",
    rendersCardTypes: ["sandbox"],
    lastModified: isoDate(),
  });

  // ## Compilation output
  //
  // The compiled output is valid JavaScript with React externalized:

  const { output } = await compileView(join(viewsDir, "test.tsx"));
  t.check(output, any(String).includes("window.__bbxReact"));

  // ## Caching
  //
  // Compiling the same file twice returns cached output (same mtime and size). To show the cache is used, the next example rewrites the source with same-length different text and restores the mtime, so only a cache can still return the old output:

  const viewFile = join(viewsDir, "test.tsx");
  const pinned = new Date("2026-01-01T00:00:00Z");
  await utimes(viewFile, pinned, pinned);
  invalidateView(viewFile);
  const { output: pinnedOutput } = await compileView(viewFile);
  await writeFile(viewFile, source.replace('"hello"', '"HELLO"'));
  await utimes(viewFile, pinned, pinned);
  const { output: output2 } = await compileView(viewFile);
  t.check(output2, pinnedOutput);

  // After invalidation, a fresh compile reads the rewritten source:

  invalidateView(viewFile);
  const { output: output3 } = await compileView(viewFile);
  t.check(output3, any(String).includes("HELLO"));
  t.check(output3, not(any(String).includes("hello")));
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
  t.check(jsxOut, any(String).includes("Array.isArray(children)"));

  // The naive alias that dropped `key` and passed array children whole is gone:

  t.check(jsxOut, not(any(String).includes("jsx = React.createElement")));
});

// ## Compile targets
//
// A view written with real JSX compiles differently per target. The default
// "browser" target externalizes React to the `window.__bbxReact` shim; the "node"
// target externalizes React to bare specifiers, so a Node renderer resolves the
// real React from node_modules and shares one instance with `react-dom/server`:
void test("A view written with real JSX compiles differently per target.", async (t) => {
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
  t.check(browserBuild.output, any(String).includes("window.__bbxReact"));

  // The browser build never emits a bare `react/jsx-runtime` import; the node build
  // does (esbuild's automatic JSX import, left external):

  t.check(browserBuild.output, not(any(String).matches(/from\s*"react\/jsx-runtime"/)));

  const nodeBuild = await compileView(viewPathT, { target: "node" });
  t.check(nodeBuild.output, any(String).matches(/from\s*"react\/jsx-runtime"/));

  t.check(nodeBuild.output, not(any(String).includes("window.__bbxReact")));

  // The node build carries an inline source map for stack mapping:

  t.check(nodeBuild.output, any(String).includes("sourceMappingURL=data:application/json"));

  // The two targets are cached independently — compiling one never returns the
  // other's output (no cross-contamination):

  t.check(nodeBuild.output, not(browserBuild.output));
});

// ## Missing metadata defaults
//
// When metadata exports are missing, sensible defaults are used:
void test("When metadata exports are missing, sensible defaults are used:", async (t) => {
  const tmp2 = await mkdtemp(join(tmpdir(), "views-test-"));
  const viewsDir2 = join(tmp2, "views");
  await mkdir(viewsDir2, { recursive: true });

  const minimal = `
export default function Minimal() {
  return window.__bbxReact.createElement("div", null, "minimal");
}
`;
  await writeFile(join(viewsDir2, "minimal.tsx"), minimal);

  const { meta } = await compileView(join(viewsDir2, "minimal.tsx"));
  t.check(meta, {
    name: "minimal",
    slug: "minimal",
    description: "",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  });

  // An unknown `layout` fails validation. The view degrades like a broken one,
  // and the marker names the export, so the author can see what to fix:

  await writeFile(join(viewsDir2, "wide.tsx"), `
export const layout = "wide";
export const rendersCardTypes = ["sandbox"];
export default function Wide() {
  return window.__bbxReact.createElement("div", null, "wide");
}
`);
  const wide = (await compileView(join(viewsDir2, "wide.tsx"))).meta;
  t.check(wide, {
    name: "wide",
    slug: "wide",
    description: "Invalid metadata export layout: Invalid option: expected one of \"inset\"|\"full-bleed\"",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  });
});

// ## Metadata import does not see server credentials
//
// Reading the exports runs the box-authored view. The child that runs it gets
// the agent profile's allowlist, so a view cannot publish a server secret as
// its name. The spawn profile is stated as `agent`:
void test("A view that exports a server secret as its name gets nothing", async (t) => {
  const saved = process.env.BBX_HUB_SECRET;
  process.env.BBX_HUB_SECRET = "server-hub-secret";
  t.teardown(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, "BBX_HUB_SECRET");
    else process.env.BBX_HUB_SECRET = saved;
  });
  const viewsDir = join(await mkdtemp(join(tmpdir(), "views-test-")), "views");
  await mkdir(viewsDir, { recursive: true });
  await writeFile(join(viewsDir, "leak.tsx"), `
export const name = String(process.env.BBX_HUB_SECRET);
export const description = String(process.env.BBX_SPAWN_PROFILE);
export default function Leak() {
  return window.__bbxReact.createElement("div", null, "leak");
}
`);
  const { meta } = await compileView(join(viewsDir, "leak.tsx"));
  t.check({ name: meta.name, description: meta.description }, { name: "undefined", description: "agent" });
});

// ## Error module
//
// When compilation fails, `buildErrorModule` creates a valid JS module that renders the error:
void test("When compilation fails, buildErrorModule creates a valid JS module that rende...", async (t) => {
  const errorJs = buildErrorModule("Unexpected token at line 5");
  t.checkText(errorJs, `export default function ErrorView() {
  return window.__bbxReact.createElement("pre", {style:{color:"red",whiteSpace:"pre-wrap",padding:"1rem"}}, \`Unexpected token at line 5\`);
}
export const name = "Error";
export const description = "Failed to compile";
export const dependencies = [];
export const modes = ["page", "chat"];`);
});

// ## Listing views
//
// `listViews` resolves the views directory from the box's shape (via
// `getBoxShape`/`boxCodePaths`), so it needs a real box — its views
// directory is `<boxRoot>/src/views`:
void test("listViews resolves the views directory from the box's shape (via getBoxShape/...", async (t) => {
  const box3 = await makeTmpBox({ deps: true });
  const tmp3 = box3.root;

  // No views/ directory — returns empty
  const empty = await listViews(tmp3);
  t.check(empty, []);

  const viewsDir3 = join(box3.root, "src/views");
  await mkdir(viewsDir3, { recursive: true });

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
  t.check(views.toSorted((a, b) => a.name.localeCompare(b.name)), [
    {
      name: "Dashboard",
      slug: "dashboard",
      description: "Overview dashboard",
      dependencies: ["_content/**/*.card"],
      modes: ["page"],
      layout: "inset",
      rendersCardTypes: [],
      lastModified: isoDate(),
    },
    {
      name: "Summary",
      slug: "summary",
      description: "Quick summary",
      dependencies: [],
      modes: ["chat"],
      layout: "inset",
      rendersCardTypes: [],
      lastModified: isoDate(),
    },
  ]);

  // A view that fails to compile still appears in the listing — degraded to its
  // filename and a `description: "Failed to compile"` marker — rather than
  // silently vanishing. Metadata now comes from importing the real module, so a
  // view that can't even compile has no metadata to import; `rendersCardTypes`
  // degrades to empty rather than being preserved (unlike the old regex fallback):

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
  t.check(broken, {
    name: "broken",
    slug: "broken",
    description: "Failed to compile",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  });
});
