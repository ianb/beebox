# Scanner: public surfaces

`scanPublicSurfaces` maps `package.json` `exports` to the build entry (or
source file) that produces each target.

```ts setup
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanEnclosingSurfaces, scanPublicSurfaces } from "../../../../../src/dev/layout/scan/package/surfaces.js";

const repoRoot = await mkdtemp(join(tmpdir(), "layout-surfaces-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}

await write(
  "pkg/package.json",
  JSON.stringify({
    exports: {
      "./cards": { types: "./dist/cards/index.d.ts", default: "./dist/cards/index.js" },
      "./schema": { types: "./dist/exports/schema.d.ts", default: "./dist/exports/schema.js" },
      "./server": "./dist/exports/server.js",
      "./widgets": { import: "./dist/widgets/index.js" },
      "./other": { node: "./dist/other/index.js", types: "./dist/other/index.d.ts" },
      "./tsconfig.base.json": "./tsconfig.base.json",
    },
  }),
);
await write(
  "pkg/scripts/build.ts",
  `import { build } from "esbuild";\nimport { join } from "node:path";\nconst root = join(import.meta.dirname, "..");\nconst distDir = join(root, "dist");\nawait build({\n  entryPoints: [join(root, "src/cards/index.ts")],\n  outfile: join(distDir, "cards", "index.js"),\n});\n`,
);
await write("pkg/src/cards/index.ts", "export {};\n");
await write("pkg/src/exports/schema.ts", "export {};\n");
await write("pkg/tsconfig.base.json", "{}\n");

const surfaces = scanPublicSurfaces({ repoRoot, packageRoot: "pkg" });
```

A build entry (`build({ entryPoints, outfile })` in `scripts/*.ts`) gives the
source for its target.

```ts
JSON.stringify(surfaces.find((s) => s.specifier === "./cards"))
=> {"specifier":"./cards","target":"pkg/dist/cards/index.js","source":"pkg/src/cards/index.ts"}
```

No build entry for `./schema`: it falls back to `<pkg>/src/exports/schema.ts`,
which exists.

```ts
JSON.stringify(surfaces.find((s) => s.specifier === "./schema"))
=> {"specifier":"./schema","target":"pkg/dist/exports/schema.js","source":"pkg/src/exports/schema.ts"}
```

No build entry and no fallback file: `source` is null. A string `exports`
value is used directly.

```ts
JSON.stringify(surfaces.find((s) => s.specifier === "./server"))
=> {"specifier":"./server","target":"pkg/dist/exports/server.js","source":null}
```

An object with no `default` prefers `import`; one with neither takes the
first string value.

```ts
JSON.stringify(surfaces.find((s) => s.specifier === "./widgets"))
=> {"specifier":"./widgets","target":"pkg/dist/widgets/index.js","source":null}

JSON.stringify(surfaces.find((s) => s.specifier === "./other"))
=> {"specifier":"./other","target":"pkg/dist/other/index.js","source":null}
```

A non-JS target's `source` is the target itself.

```ts
JSON.stringify(surfaces.find((s) => s.specifier === "./tsconfig.base.json"))
=> {"specifier":"./tsconfig.base.json","target":"pkg/tsconfig.base.json","source":"pkg/tsconfig.base.json"}
```

## No `package.json`

```ts
scanPublicSurfaces({ repoRoot, packageRoot: "pkg/nope" }).length
=> 0
```

## `scanEnclosingSurfaces` walks up to every enclosing `package.json`

A nested package (`pkg/nested`) has no `exports` of its own; its enclosing
chain is `pkg`, then the repo root. `pkg` declares `./cards`, built from a
module inside the nested package itself — the same shape as `beebox`'s
`./view-widgets`, sourced from a file inside `beebox/src/frontend/`. The
repo root also declares its own export.

```ts
await write("pkg/nested/package.json", JSON.stringify({ name: "nested" }));
await write("package.json", JSON.stringify({ exports: { "./root-thing": "./dist/root-thing.js" } }));

const enclosing = scanEnclosingSurfaces({ repoRoot, packageRoot: "pkg/nested" });
JSON.stringify(enclosing.map((s) => s.specifier))
=> ["./cards","./schema","./server","./widgets","./other","./tsconfig.base.json","./root-thing"]

enclosing.find((s) => s.specifier === "./cards")?.source
=> pkg/src/cards/index.ts
```

Scanning `pkg` itself only walks to the repo root.

```ts
JSON.stringify(scanEnclosingSurfaces({ repoRoot, packageRoot: "pkg" }).map((s) => s.specifier))
=> ["./root-thing"]
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
