# Plugin bundles

`src/scripts/build-cli/build/plugins.ts` enumerates `src/plugins/*` and
bundles each plugin's `plugin.ts` (Node) and `view.tsx` (browser) to the
`dist/plugins/<name>/` files the `package.json` `exports` map advertises.
`bundle.ts` (`build:cli`) imports it; `pnpm build` runs it after `tsc`.

```ts setup
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build } from "esbuild";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";
import {
  PLUGIN_CSS_ATTRIBUTE,
  cssInlinePlugin,
  listPluginEntries,
  pluginOutfiles,
} from "../../../../src/scripts/build-cli/build/plugins.js";

const root = await mkdtemp(join(tmpdir(), "plugin-bundles-"));
async function write(rel: string, content: string) {
  const full = join(root, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
await write("src/plugins/alpha/plugin.ts", "export default { name: 'alpha' };\n");
await write("src/plugins/alpha/view.tsx", "export default () => null;\n");
await write("src/plugins/beta/plugin.ts", "export default { name: 'beta' };\n");
await write("src/plugins/docs-only/README.md", "# nothing to build\n");
await write("src/plugins/stray.ts", "export {};\n");

const entries = await listPluginEntries(root);
const rel = (p: string | null) => (p === null ? null : relative(root, p));
```

## Enumeration

Every directory under `src/plugins/` is an entry, sorted by name, with the
entry modules it holds; a file directly in `src/plugins/` is not a plugin.

```ts
entries.map((e) => ({ name: e.name, index: rel(e.index), view: rel(e.view) }))
=>
[
  { name: "alpha", index: "src/plugins/alpha/plugin.ts", view: "src/plugins/alpha/view.tsx" },
  { name: "beta", index: "src/plugins/beta/plugin.ts", view: null },
  { name: "docs-only", index: null, view: null },
]

await listPluginEntries(join(root, "no-such-root"))
=> []
```

## The build writes exactly what the exports map advertises

`pluginOutfiles` is the dist-relative file list one entry produces. Each
file is the `default` target of `./plugins/*` or `./plugins/*/view` in this
package's `exports` with `*` replaced by the plugin name, so the map never
names a file the build does not emit.

```ts
const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"));
const indexTarget = pkg.exports["./plugins/*"].default;
const viewTarget = pkg.exports["./plugins/*/view"].default;
[indexTarget, viewTarget]
=> ["./dist/plugins/*/plugin.js", "./dist/plugins/*/view.js"]

entries.flatMap((e) => pluginOutfiles(e).map((f) => `./dist/${f}`))
=> ["./dist/plugins/alpha/plugin.js", "./dist/plugins/alpha/view.js", "./dist/plugins/beta/plugin.js"]

entries.flatMap((e) =>
  pluginOutfiles(e).map((f) => {
    const expected = (f.endsWith("/view.js") ? viewTarget : indexTarget).replace("*", e.name);
    return `./dist/${f}` === expected;
  }),
)
=> [true, true, true]
```

## A stylesheet import becomes one `<style>` element, appended once

The esbuild plugin turns `import "x.css"` into JavaScript that appends a
`<style data-bbx-plugin-css="<sha1>">` to `document.head` at module load,
unless an element with that hash is already there. Two separate bundles that
carry the same stylesheet (two plugin views, or one view compiled into two
box views) therefore add it once; a different stylesheet gets its own
element. The bundles below run against a minimal fake `document`.

```ts
await write("css/shared.css", ".concept { color: red }\n");
await write("css/other.css", ".other { color: blue }\n");
await write("css/one.ts", `import "./shared.css";\nexport const one = 1;\n`);
await write("css/two.ts", `import "./shared.css";\nimport "./other.css";\nexport const two = 2;\n`);

async function bundleText(entry: string) {
  const result = await build({
    entryPoints: [join(root, "css", entry)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    plugins: [cssInlinePlugin()],
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}
function fakeDocument() {
  const styles = [];
  return {
    styles,
    head: {
      querySelector(selector) {
        const hash = /="([0-9a-f]+)"/.exec(selector)?.[1];
        return styles.find((s) => s.hash === hash) ?? null;
      },
      appendChild(el) { styles.push(el); },
    },
    createElement(tag) {
      return { tag, attribute: null, hash: null, textContent: "", setAttribute(name, value) { this.attribute = name; this.hash = value; } };
    },
  };
}

const oneJs = await bundleText("one.ts");
const twoJs = await bundleText("two.ts");
const doc = fakeDocument();
const run = (code) => new Function("document", code)(doc);
run(oneJs);
run(oneJs);
run(twoJs);
doc.styles.map((s) => `${s.tag}[${s.attribute}=${s.hash}] ${s.textContent.trim()}`)
=>
[
  "style[data-bbx-plugin-css=«a=*»] .concept { color: red }",
  "style[data-bbx-plugin-css=«b=*»] .other { color: blue }",
]

PLUGIN_CSS_ATTRIBUTE
=> data-bbx-plugin-css
```

Without a `document` (Node, or `bbx view test` rendering on the server) the
module loads and appends nothing.

```ts continue
new Function("document", oneJs)(undefined);
"loaded"
=> loaded
```

```ts teardown
await rm(root, { recursive: true, force: true });
```
