# Views compiler: a box view that re-exports a plugin view

A plugin view (`beebox/plugins/<name>/view`, built by
`src/scripts/build-cli/build/plugins.ts`) reaches a box through a stub in
`src/views/` that re-exports it as the default and declares the view metadata.
The stub compiles like any other view, which bundles the plugin view into it.
Three things have to line up for that to load:

- The plugin bundle must not contain a CommonJS `require("react")`. esbuild
  turns a `require` of a plain external into a `__require` that throws
  "Dynamic require of 'react' is not supported" at load, in Node and in the
  browser. React Flow's zustand does exactly that, so the build routes every
  `react` import through one shim module that imports React as its default
  export and re-exports each public name.
- The browser compile must shim `react-dom` as well as `react` (React Flow's
  portals import it), and the `react` shim must carry the whole public
  surface: `useSyncExternalStore`, `useLayoutEffect`, `useId` and
  `useImperativeHandle` were missing from the hand list before.
- The node compile (`bbx view test`, metadata import) must leave `react-dom`
  external so the box's copy is used, not a second one bundled in.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { buildPluginBundlesIntoDist } from "../../helpers/plugin-bundles.js";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { bundleView, compileView } from "../../../src/webapp/views/compiler/compile.js";
import { boxPackageHost, writeNodeViewModule } from "../../../src/webapp/views/node-view-runtime.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { loadViewCards } from "../../../src/core/views/cards.js";

const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

// A box with `node_modules/beebox` plus the `react` and `react-dom` a real box
// declares as dependencies (src/core/box/package.ts), symlinked to the engine's
// copies so the rendered view shares this process's React instance.
async function makeViewBox() {
  const box = await makeTmpBox({ deps: true, git: true });
  const reactNodeModules = dirname(dirname(requireFromEngine.resolve("react/package.json")));
  await symlink(join(reactNodeModules, "react"), join(box.root, "node_modules", "react"), "dir");
  await symlink(join(reactNodeModules, "react-dom"), join(box.root, "node_modules", "react-dom"), "dir");
  return box;
}


// A box activates the plugin by naming it in `_config/box.json` and writing the
// stubs its README lists (docs/plugins.md): the schema stub makes `concept-map`
// a card type the loader recognizes; the view stub is the view under test.
const SCHEMA_STUB = `import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";
export default cardSchema("concept-map", courseware.schemas["concept-map"]);
`;
async function activateCourseware(box) {
  await box.write("_config/box.json", JSON.stringify({ plugins: ["courseware"] }, null, 2) + "\n");
  await mkdir(join(box.root, "src", "schemas"), { recursive: true });
  await writeFile(join(box.root, "src", "schemas", "concept-map.ts"), SCHEMA_STUB);
}

const STUB = `export { default } from "beebox/plugins/courseware/view";
export const rendersCardTypes = ["concept-map"];
export const dependencies = ["**/*.concept-map.card"];
`;

const CARD_PATH = "_content/courses/Fractions.concept-map.card";
const FRACTIONS_CARD = `---
concepts:
  - id: part-whole
    name: Part-whole meaning
    kind: concept
    related:
      - to: equivalence
        kind: prerequisite
  - id: equivalence
    name: Equivalent fractions
    kind: principle
  - id: adding
    name: Adding unlike denominators
    kind: procedure
---
Fractions name parts of a whole; this map orders what to learn first.
`;

// What `bbx view test` does (src/cli/commands/view/command.ts): compile for
// Node, write the module beside the box's node_modules, import it, load the
// cards its metadata selects, render inside the node view host.
async function renderThroughCompiler(box, params) {
  const viewHost = boxPackageHost(await getBoxShape(box.root));
  const viewPath = join(box.root, "src", "views", "concept-map.tsx");
  const { output, meta } = await compileView(viewPath, { target: "node", viewHost });
  const mod = await writeNodeViewModule(output, viewHost);
  try {
    const viewMod = await import(mod.moduleUrl);
    const { cards, files } = await loadViewCards(box.root, meta.dependencies);
    const { NodeViewHostProvider } = await import("beebox/view-widgets");
    const props = { cards, files, params, boxSlug: "test", navigate: () => {}, reportActivity: () => {} };
    const html = renderToString(createElement(NodeViewHostProvider, { boxSlug: "test", children: createElement(viewMod.default, props) }));
    return { html, meta };
  } finally {
    await mod.cleanup();
  }
}

await buildPluginBundlesIntoDist();
const box = await makeViewBox();
await activateCourseware(box);
await box.write(CARD_PATH, FRACTIONS_CARD);
await mkdir(join(box.root, "src", "views"), { recursive: true });
await writeFile(join(box.root, "src", "views", "concept-map.tsx"), STUB);
```

## The plugin bundle takes React from its host

The built bundle has no `__require("react")` left; its only `react` and
`react-dom` references are the shim modules' own imports, one per specifier:

```ts
const bundle = await readFile(join(PACKAGE_ROOT, "dist", "plugins", "courseware", "view.js"), "utf8");
[bundle.includes('__require("react")'), bundle.includes('require("react")')]
=> [false, false]

[...bundle.matchAll(/^import (\w+) from "(react[^"]*)";$/gm)].map((m) => m[2]).toSorted()
=> ["react", "react-dom", "react/jsx-runtime"]
```

## The stub renders through the node compile

The stub's metadata comes from the real import, and the rendered page has the
card's prose (through `Markdown`) and every concept's name:

```ts
const { html, meta } = await renderThroughCompiler(box, { path: CARD_PATH });
[meta.rendersCardTypes, meta.dependencies]
=> [["concept-map"], ["**/*.concept-map.card"]]

["this map orders what to learn first", "Part-whole meaning", "Equivalent fractions", "Adding unlike denominators"].map((s) => html.includes(s))
=> [true, true, true, true]
```

## The browser compile shims react-dom and carries the full React surface

The stub's browser module has no `require("react")` either, and reads both
host globals:

```ts
const { output } = await bundleView(join(box.root, "src", "views", "concept-map.tsx"), { cache: false });
[output.includes('__require("react")'), output.includes('require("react')]
=> [false, false]

[output.includes("window.__bbxReact;"), output.includes("window.__bbxReactDOM;")]
=> [true, true]
```

The `react` shim's named exports are the installed React's public surface,
not a hand list, and `react-dom` has a shim of its own:

```ts
await writeFile(join(box.root, "src", "views", "hooks.tsx"), `import { useSyncExternalStore, useLayoutEffect, useId, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
export default function Hooks() { useId(); return createPortal(null, document.body); }
`);
const hooks = (await bundleView(join(box.root, "src", "views", "hooks.tsx"), { cache: false })).output;
["useSyncExternalStore", "useLayoutEffect", "useId", "useImperativeHandle", "createPortal"].map((name) => new RegExp(`Host\\d* = window\\.__bbxReact(DOM)?;[^]*?= Host\\d*\\.${name};`).test(hooks))
=> [true, true, true, true, true]
```

A view may import only the host modules the shims cover:

```ts
await writeFile(join(box.root, "src", "views", "server.tsx"), `import { renderToString } from "react-dom/server";\nexport default () => renderToString(null);\n`);
await bundleView(join(box.root, "src", "views", "server.tsx"), { cache: false })
=> throws Error: Build failed with 1 error:«*»react-dom/server is not available to a view«*»
```

```ts cleanup
await box.cleanup();
```
