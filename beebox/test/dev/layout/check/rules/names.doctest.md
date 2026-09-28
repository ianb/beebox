# Names: no `index`, exports-only re-exports, no repeated name

`namesRule` covers rule 6 (no module is named `index`; a re-export module
lives only in `<sourceRoot>/exports`; a public surface's build target maps
back to that directory) and principle 4 (a file name never repeats its
directory's name).

```ts setup
import { namesRule } from "../../../../../src/dev/layout/check/rules/names.js";
import { layout, summary } from "./fixture.js";

const check = (l: ReturnType<typeof layout>) => namesRule.check(l);
```

## No module is named `index`

A module, test, or declaration file named `index` is flagged regardless of
extension; a data file with the same stem (`index.html`) is outside the
rule's scope and gets no finding.

```ts
const noIndex = layout({
  files: {
    "src/index.ts": {},
    "src/foo/index.tsx": {},
    "src/foo/index.d.ts": "declaration",
    "src/foo/index.html": "data",
  },
});
summary(check(noIndex))
=>
no-index pkg/src/foo/index.d.ts
no-index pkg/src/foo/index.tsx
no-index pkg/src/index.ts

check(noIndex)[0]?.message
=> name the module by what it does; index names nothing
```

## Re-export modules live only in `<sourceRoot>/exports`

A `reexportOnly` module inside `src/exports/` is clean, including when it is
itself a public surface's source; the same module elsewhere is flagged.

```ts
const reexport = layout({
  files: {
    "src/exports/schema.ts": { reexportOnly: true },
    "src/cards.ts": { reexportOnly: true },
  },
  publicSurfaces: [{ specifier: "./schema", target: "dist/schema.js", source: "src/exports/schema.ts" }],
});
summary(check(reexport))
=>
reexport-surface pkg/src/cards.ts

check(reexport)[0]?.message
=> re-export modules exist only as public surfaces in pkg/src/exports; import from the defining modules instead
```

## Public surfaces: build target, source location, and exports/ membership

A code-target (`.js`/`.mjs`/`.cjs`) surface with no known source is flagged
at the target; one built from a module outside `src/exports/` is flagged at
the source, with a move instruction. A JSON-target surface is a data export
and is skipped even when its source is misplaced. Every module directly in
`src/exports/` must be some surface's source (`widgets.ts`, `view-widgets.tsx`
below); a `.d.ts` there is allowed once some surface names the matching
specifier (`view-widgets.d.ts` allowed by `./view-widgets`); an unclaimed
module (`orphan.ts`) is flagged.

```ts
const surfaces = layout({
  files: {
    "src/exports/widgets.ts": {},
    "src/exports/orphan.ts": {},
    "src/exports/view-widgets.tsx": {},
    "src/exports/view-widgets.d.ts": "declaration",
    "src/legacy/cards.ts": {},
  },
  publicSurfaces: [
    { specifier: "./widgets", target: "dist/widgets.js", source: "src/exports/widgets.ts" },
    { specifier: "./missing", target: "dist/missing.js", source: null },
    { specifier: "./legacy", target: "dist/legacy.js", source: "src/legacy/cards.ts" },
    { specifier: "./config", target: "tsconfig.base.json", source: "src/legacy/cards.ts" },
    { specifier: "./view-widgets", target: "dist/view-widgets.js", source: "src/exports/view-widgets.tsx" },
  ],
});
summary(check(surfaces))
=>
public-surface pkg/dist/missing.js
public-surface pkg/src/exports/orphan.ts
public-surface pkg/src/legacy/cards.ts

check(surfaces).find((f) => f.path === "pkg/dist/missing.js")?.message
=> cannot find the source the build produces pkg/dist/missing.js from

check(surfaces).find((f) => f.path === "pkg/src/legacy/cards.ts")?.message
=> public surface ./legacy is built from pkg/src/legacy/cards.ts; move it to pkg/src/exports/

check(surfaces).find((f) => f.path === "pkg/src/exports/orphan.ts")?.message
=> not a public surface; every module in pkg/src/exports is a package export's source
```

Each message in full, above.

## A surface source can live in a nested package's own `src/exports/`

`beebox`'s `./view-widgets` is built from a module inside its nested
`frontend` package. Rule 6 holds that module to `frontend`'s OWN
`src/exports/`, not `pkg`'s: it already lives there, so there is no
finding, even though it sits outside `pkg/src/exports`.

```ts
const nestedSource = layout({
  files: {
    "src/frontend/src/exports/view-widgets.tsx": {},
  },
  nestedPackages: ["src/frontend"],
  publicSurfaces: [
    { specifier: "./view-widgets", target: "dist/view-widgets.js", source: "src/frontend/src/exports/view-widgets.tsx" },
  ],
});
summary(check(nestedSource)) === ""
=> true
```

A source outside that nested package's `src/exports/` is still flagged,
naming the nested package's export directory as the destination.

```ts
const nestedMisplaced = layout({
  files: {
    "src/frontend/src/widgets.tsx": {},
  },
  nestedPackages: ["src/frontend"],
  publicSurfaces: [
    { specifier: "./view-widgets", target: "dist/view-widgets.js", source: "src/frontend/src/widgets.tsx" },
  ],
});
check(nestedMisplaced)[0]?.message
=> public surface ./view-widgets is built from pkg/src/frontend/src/widgets.tsx; move it to pkg/src/frontend/src/exports/
```

## A module in `src/exports/` can be named by an enclosing package's surface

`frontend`'s own `view-widgets.tsx` (scanned as `pkg` here, standing in for
the nested package) declares no surface of its own, but `enclosingSurfaces`
carries the outer package's `./view-widgets`, sourced from this same file:
that satisfies finding 4, so the module is not flagged as an orphan.

```ts
const enclosingNamed = layout({
  files: {
    "src/exports/view-widgets.tsx": {},
  },
  enclosingSurfaces: [
    { specifier: "./view-widgets", target: "../dist/view-widgets.js", source: "src/exports/view-widgets.tsx" },
  ],
});
summary(check(enclosingNamed)) === ""
=> true
```

## A data file in `src/exports/` is out of scope for public-surface membership

```ts
const dataInExports = layout({
  files: {
    "src/exports/schema.ts": {},
    "src/exports/tsconfig.json": "data",
  },
  publicSurfaces: [{ specifier: "./schema", target: "dist/schema.js", source: "src/exports/schema.ts" }],
});
summary(check(dataInExports)) === ""
=> true
```

## A file name never repeats its directory's name

Equal (`router/router.ts`) and prefixed (`router/router-core.ts`) both
count, for modules and tests alike; a file in the source root itself is
exempt, and a test whose stem matches its own directory (not the module it
covers) gets no finding.

```ts
const repeated = layout({
  files: {
    "src/router/router-core.ts": {},
    "src/router/router.ts": {},
    "src/top-level.ts": {},
    "test/core/chat/session/history.doctest.md": { test: [] },
    "test/router/router-core.doctest.md": { test: [] },
  },
});
summary(check(repeated))
=>
repeated-name pkg/src/router/router-core.ts
repeated-name pkg/src/router/router.ts
repeated-name pkg/test/router/router-core.doctest.md

check(repeated).find((f) => f.path === "pkg/src/router/router.ts")?.message
=> name it by what it does; router/router repeats the directory

check(repeated).find((f) => f.path === "pkg/src/router/router-core.ts")?.message
=> drop the router- prefix: the directory already says it
```

Both message shapes shown above.

## Clean layout

```ts
const clean = layout({
  files: {
    "src/router/dispatch.ts": {},
    "src/exports/schema.ts": {},
  },
  publicSurfaces: [{ specifier: "./schema", target: "dist/schema.js", source: "src/exports/schema.ts" }],
});
summary(check(clean)) === ""
=> true
```
