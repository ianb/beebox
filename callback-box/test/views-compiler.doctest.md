# Views Compiler

The views compiler takes agent-written `.tsx` files and compiles them to ES modules using esbuild. It extracts metadata from named exports and caches compiled output by mtime.

```ts setup
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { compileView, listViews, buildErrorModule, invalidateView } from "../src/webapp/views/compiler.js";
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

`listViews` scans a box's `views/` directory:

```ts
const tmp3 = await mkdtemp(join(tmpdir(), "views-test-"));

// No views/ directory — returns empty
const empty = await listViews(tmp3);
empty.length
=> 0
```

```ts continue
const viewsDir3 = join(tmp3, "views");
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
