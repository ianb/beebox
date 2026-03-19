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

The compiler extracts name, description, dependencies, and modes from `export const` declarations via regex:

```
const tmp = await mkdtemp(join(tmpdir(), "views-test-"));
const viewsDir = join(tmp, "views");
await mkdir(viewsDir, { recursive: true });

const source = `
export const name = "Test View";
export const description = "A simple test";
export const dependencies = ["box/**/*.card", "store/**/*.card"];
export const modes = ["page", "chat"];
export default function Test() {
  return window.__cbReact.createElement("div", null, "hello");
}
`;
await writeFile(join(viewsDir, "test.tsx"), source);

const { meta } = await compileView(join(viewsDir, "test.tsx"));
meta.name
=> Test View
```

``` continue
meta.slug
=> test

meta.description
=> A simple test

JSON.stringify(meta.dependencies)
=> ["box/**/*.card","store/**/*.card"]

JSON.stringify(meta.modes)
=> ["page","chat"]
```

## Compilation output

The compiled output is valid JavaScript with React externalized:

``` continue
const { output } = await compileView(join(viewsDir, "test.tsx"));
output.includes("window.__cbReact")
=> true
```

The compiled output is a valid ES module with exports:

``` continue
output.includes("as default")
=> true

output.includes("name")
=> true
```

## Caching

Compiling the same file twice returns cached output (same mtime):

``` continue
const { output: output2 } = await compileView(join(viewsDir, "test.tsx"));
output === output2
=> true
```

After invalidation, a fresh compile occurs:

``` continue
invalidateView(join(viewsDir, "test.tsx"));
const { output: output3 } = await compileView(join(viewsDir, "test.tsx"));
output === output3
=> true
```

## Missing metadata defaults

When metadata exports are missing, sensible defaults are used:

```
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

``` continue
meta.slug
=> minimal

meta.description
=>

JSON.stringify(meta.dependencies)
=> []
```

## Error module

When compilation fails, `buildErrorModule` creates a valid JS module that renders the error:

```
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

```
const tmp3 = await mkdtemp(join(tmpdir(), "views-test-"));

// No views/ directory — returns empty
const empty = await listViews(tmp3);
empty.length
=> 0
```

``` continue
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

``` continue
const names = views.map(v => v.name).sort();
JSON.stringify(names)
=> ["Dashboard","Summary"]
```
