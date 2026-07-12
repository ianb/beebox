# Views Compiler

The views compiler takes agent-written `.tsx` files and compiles them to ES modules using esbuild. It extracts metadata from named exports and caches compiled output by mtime.

```ts setup
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { compileView, listViews, buildErrorModule, invalidateView } from "../../src/webapp/views/compiler.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Metadata extraction

The compiler extracts name, description, dependencies, modes, and rendersCardTypes from `export const` declarations via regex:

```ts
const tmp = await mkdtemp(join(tmpdir(), "views-test-"));
const viewsDir = join(tmp, "views");
await mkdir(viewsDir, { recursive: true });

const source = `
export const name = "Test View";
export const description = "A simple test";
export const dependencies = ["box/**/*.card", "store/**/*.card"];
export const modes = ["page", "chat"];
export const rendersCardTypes = ["sandbox"];
export default function Test() {
  return window.__cbReact.createElement("div", null, "hello");
}
`;
await writeFile(join(viewsDir, "test.tsx"), source);

const { meta } = await compileView(join(viewsDir, "test.tsx"));
meta.name
=> Test View
```

```ts continue
meta.slug
=> test

meta.description
=> A simple test

JSON.stringify(meta.dependencies)
=> ["box/**/*.card","store/**/*.card"]

JSON.stringify(meta.rendersCardTypes)
=> ["sandbox"]

JSON.stringify(meta.modes)
=> ["page","chat"]
```

## Compilation output

The compiled output is valid JavaScript with React externalized:

```ts continue
const { output } = await compileView(join(viewsDir, "test.tsx"));
output.includes("window.__cbReact")
=> true
```

The compiled output is a valid ES module with exports:

```ts continue
output.includes("as default")
=> true

output.includes("name")
=> true
```

## Caching

Compiling the same file twice returns cached output (same mtime):

```ts continue
const { output: output2 } = await compileView(join(viewsDir, "test.tsx"));
output === output2
=> true
```

After invalidation, a fresh compile occurs:

```ts continue
invalidateView(join(viewsDir, "test.tsx"));
const { output: output3 } = await compileView(join(viewsDir, "test.tsx"));
output === output3
=> true
```

## jsx-runtime shim translates the automatic runtime

A view written with real JSX compiles against the `react/jsx-runtime` shim. The
shim must translate `jsx`/`jsxs` (children carried *inside* props, `key` a
separate arg) into `createElement` (children as rest args) — otherwise a
static-children array reaches `createElement` as a single array child and React
emits a spurious "unique key" dev warning for every multi-child view. The fix
spreads the children array, so the compiled shim carries the `Array.isArray`
translation rather than a naive `jsx = React.createElement` alias.

```ts
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
jsxOut.includes("Array.isArray(children)")
=> true
```

The naive alias that dropped `key` and passed array children whole is gone:

```ts continue
jsxOut.includes("jsx = React.createElement")
=> false
```

## Compile targets

A view written with real JSX compiles differently per target. The default
"browser" target externalizes React to the `window.__cbReact` shim; the "node"
target externalizes React to bare specifiers, so a Node renderer resolves the
real React from node_modules and shares one instance with `react-dom/server`:

```ts
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
browserBuild.output.includes("window.__cbReact")
=> true
```

The browser build never emits a bare `react/jsx-runtime` import; the node build
does (esbuild's automatic JSX import, left external):

```ts continue
/from\s*"react\/jsx-runtime"/.test(browserBuild.output)
=> false
```

```ts continue
const nodeBuild = await compileView(viewPathT, { target: "node" });
/from\s*"react\/jsx-runtime"/.test(nodeBuild.output)
=> true
```

```ts continue
nodeBuild.output.includes("window.__cbReact")
=> false
```

The node build carries an inline source map for stack mapping:

```ts continue
nodeBuild.output.includes("sourceMappingURL=data:application/json")
=> true
```

The two targets are cached independently — compiling one never returns the
other's output (no cross-contamination):

```ts continue
nodeBuild.output === browserBuild.output
=> false
```

## Missing metadata defaults

When metadata exports are missing, sensible defaults are used:

```ts
const tmp2 = await mkdtemp(join(tmpdir(), "views-test-"));
const viewsDir2 = join(tmp2, "views");
await mkdir(viewsDir2, { recursive: true });

const minimal = `
export default function Minimal() {
  return window.__cbReact.createElement("div", null, "minimal");
}
`;
await writeFile(join(viewsDir2, "minimal.tsx"), minimal);

const { meta } = await compileView(join(viewsDir2, "minimal.tsx"));
meta.name
=> minimal
```

```ts continue
meta.slug
=> minimal

meta.description
=>

JSON.stringify(meta.dependencies)
=> []
```

## Error module

When compilation fails, `buildErrorModule` creates a valid JS module that renders the error:

```ts
const errorJs = buildErrorModule("Unexpected token at line 5");
errorJs.includes("Compile error")
=> false

errorJs.includes("Unexpected token at line 5")
=> true

errorJs.includes("export default")
=> true
```

## Listing views

`listViews` resolves the views directory from the box's shape (via
`getBoxShape`/`boxCodePaths`), so it needs a real v2 box — its views
directory is `<packageRoot>/src/views`:

```ts
const box3 = await makeTmpBox({ deps: true });
const tmp3 = box3.root;

// No views/ directory — returns empty
const empty = await listViews(tmp3);
empty.length
=> 0
```

```ts continue
const viewsDir3 = join(box3.packageRoot, "src/views");
await mkdir(viewsDir3, { recursive: true });

await writeFile(join(viewsDir3, "dashboard.tsx"), `
export const name = "Dashboard";
export const description = "Overview dashboard";
export const dependencies = ["box/**/*.card"];
export const modes = ["page"];
export default function Dashboard() {
  return window.__cbReact.createElement("div", null, "dash");
}
`);

await writeFile(join(viewsDir3, "summary.tsx"), `
export const name = "Summary";
export const description = "Quick summary";
export const dependencies = [];
export const modes = ["chat"];
export default function Summary() {
  return window.__cbReact.createElement("div", null, "sum");
}
`);

const views = await listViews(tmp3);
views.length
=> 2
```

```ts continue
const names = views.map(v => v.name).sort();
JSON.stringify(names)
=> ["Dashboard","Summary"]
```

A view that fails to compile still appears in the listing — degraded to its
filename and a `description: "Failed to compile"` marker — rather than
silently vanishing. Metadata now comes from importing the real module, so a
view that can't even compile has no metadata to import; `rendersCardTypes`
degrades to empty rather than being preserved (unlike the old regex fallback):

```ts continue
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
JSON.stringify([broken.name, broken.rendersCardTypes, broken.description])
=> ["broken",[],"Failed to compile"]
```

A view whose module never finishes evaluating (an infinite loop at module
scope) can't hang the lister — the subprocess import is timeout-bounded, so
it degrades the same way a compile failure does:

```ts continue
await writeFile(join(viewsDir3, "hangs.tsx"), `
export const name = "Hangs";
while (true) {}
export default function Hangs() { return null; }
`);

const withHang = await listViews(tmp3);
const hung = withHang.find(v => v.slug === "hangs");
JSON.stringify([hung.name, hung.description])
=> ["hangs","Failed to compile"]
```
