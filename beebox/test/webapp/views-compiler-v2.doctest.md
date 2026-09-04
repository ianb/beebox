# Views compiler: v3 (one-root, package-shaped) boxes

A v3 box has one root — `.beebox/box.json` (declaring `shapeVersion: 3`) sits
alongside a real `node_modules/beebox` dependency. Its views live at
`boxRoot/src/views`. `listViews`/`compileView` resolve that directory from
the box's shape (`getBoxShape`/`boxCodePaths`), reading a view's metadata by
compiling it for the node target and importing the real module (in a
timeout-bounded subprocess) rather than regexing source text.

```ts setup
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { listViews } from "../../src/webapp/views/compiler.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

/**
 * Build a v3 (one-root, package-shaped) fixture box: a root with its own
 * `node_modules/beebox` and `node_modules/react` — symlinked to the
 * real engine copies, the same temp-symlink trick `bbx view test` uses
 * (src/cli/commands/view.ts), adapted here to simulate what a real
 * `pnpm install` of beebox would produce for a box's OWN node_modules.
 */
async function makeV3Box() {
  const root = await mkdtemp(join(tmpdir(), "bbx-v3box-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, dependencies: { "beebox": "0.1.0" } }),
  );
  await mkdir(join(root, "node_modules"), { recursive: true });
  await symlink(PACKAGE_ROOT, join(root, "node_modules", "beebox"), "dir");
  const reactNodeModules = dirname(dirname(requireFromEngine.resolve("react/package.json")));
  await symlink(join(reactNodeModules, "react"), join(root, "node_modules", "react"), "dir");
  await mkdir(join(root, ".beebox"), { recursive: true });
  await writeFile(join(root, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  await mkdir(join(root, "src", "views"), { recursive: true });
  return {
    root,
    contentRoot: root,
    async writeView(name, content) {
      await writeFile(join(root, "src", "views", name), content);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

// Metadata computed at module scope (not a string literal `export const`) —
// a regex over source text can't see this; only a real import can.
const WIDGET_VIEW = `
import { CardLink } from "beebox/view-widgets";
const parts = ["Wid", "get", " View"];
export const name = parts.join("");
export const description = "renders a CardLink from beebox/view-widgets";
export const dependencies = [];
export const modes = ["page"];
export default function WidgetView() {
  return <div><CardLink cardRef="_content/inbox/Test.memo.card" /></div>;
}
`;

function runViewTest(contentRoot, slug) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "dist/cli.mjs"), "view", "test", slug], {
      cwd: contentRoot,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
```

## listViews finds a view at `boxRoot/src/views`

```ts
const box = await makeV3Box();
await box.writeView("widget-view.tsx", WIDGET_VIEW);

const views = await listViews(box.contentRoot);
JSON.stringify(views.map((v) => v.slug))
=> ["widget-view"]
```

## Its metadata comes from the real module exports, not regex

`name` is computed (`parts.join("")`) — a fallback to the slug would mean the
import never happened:

```ts continue
const meta = views[0];
JSON.stringify({ name: meta.name, description: meta.description, modes: meta.modes })
=> {"name":"Widget View","description":"renders a CardLink from beebox/view-widgets","modes":["page"]}
```

## `bbx view test` renders it, resolving `beebox/view-widgets` and `react` through the box's own real `node_modules`

```ts continue
const r = await runViewTest(box.contentRoot, "widget-view");
r.code
=> 0
```

The rendered `<CardLink>` derives its label from the ref's filename (`Test`):

```ts continue
r.stdout.includes(">Test<")
=> true
```

```ts cleanup
await box.cleanup();
```

## A broken view still appears in the listing, degraded to an error marker

```ts
const box = await makeV3Box();
await box.writeView("broken.tsx", `
export const name = "Broken";
export default function Broken() {
  const x = ;
  return null;
}
`);

const views = await listViews(box.contentRoot);
JSON.stringify([views[0].slug, views[0].description])
=> ["broken","Failed to compile"]
```

```ts cleanup
await box.cleanup();
```

## A view whose module scope never resolves can't hang the lister

A top-level infinite loop blocks module evaluation forever; the metadata
import runs in a killable subprocess with a timeout, so `listViews` still
returns promptly with the view marked broken rather than hanging:

```ts
const box = await makeV3Box();
await box.writeView("hangs.tsx", `
export const name = "Hangs";
while (true) {}
export default function Hangs() { return null; }
`);

const start = Date.now();
const views = await listViews(box.contentRoot);
const elapsedMs = Date.now() - start;
JSON.stringify([views[0].slug, views[0].description, elapsedMs < 10000])
=> ["hangs","Failed to compile",true]
```

```ts cleanup
await box.cleanup();
```
```
