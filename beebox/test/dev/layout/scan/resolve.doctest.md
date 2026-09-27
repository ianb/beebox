# Scanner: specifier resolution

`resolveImport` resolves a relative or tsconfig-aliased specifier to a
repo-relative file, checked against the real filesystem; a bare specifier
that matches no alias is external.

```ts setup
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAliases, resolveImport, resolveRepoRelative } from "../../../../src/dev/layout/scan/resolve.js";

const repoRoot = await mkdtemp(join(tmpdir(), "layout-resolve-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}

await write("pkg/tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@x/*": ["./dir/*"] } } }));
await write("pkg/dir/foo.ts", "export const foo = 1;\n");
await write("pkg/src/a.ts", "export const a = 1;\n");
await write("pkg/src/b.ts", "export const b = 1;\n");
await write("pkg/src/util/index.ts", "export const util = 1;\n");

const aliases = loadAliases({ repoRoot, packageRoot: "pkg" });
```

## A pure path join, no filesystem involved

```ts
resolveRepoRelative({ fromDir: "a/b", relative: "../c" })
=> a/c
```

## An alias resolves through `baseUrl`/`paths`

```ts
aliases.baseDir
=> pkg

JSON.stringify(resolveImport({ specifier: "@x/foo", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":"pkg/dir/foo.ts","external":false}
```

## `.js` swapped for `.ts` when the exact path is absent

```ts
JSON.stringify(resolveImport({ specifier: "./b.js", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":"pkg/src/b.ts","external":false}
```

## Appending `/index.ts` when a directory has no extension match

```ts
JSON.stringify(resolveImport({ specifier: "./util", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":"pkg/src/util/index.ts","external":false}
```

## A Vite query suffix (`?url`, `?raw`, ...) is stripped before resolving

```ts
JSON.stringify(resolveImport({ specifier: "./b.js?url", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":"pkg/src/b.ts","external":false}
```

## A relative specifier that resolves to no file on disk

```ts
JSON.stringify(resolveImport({ specifier: "./missing.js", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":null,"external":false}
```

## An alias match whose target resolves to no file on disk

```ts
JSON.stringify(resolveImport({ specifier: "@x/missing", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":null,"external":false}
```

## A bare specifier matching no alias is external

```ts
JSON.stringify(resolveImport({ specifier: "zod", importerPath: "pkg/src/a.ts", repoRoot, aliases }))
=> {"target":null,"external":true}
```

## No `tsconfig.json`: `baseDir` defaults to the package root, no aliases

```ts
const noConfig = loadAliases({ repoRoot, packageRoot: "pkg/dir" });
noConfig.baseDir
=> pkg/dir

noConfig.entries.length
=> 0
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
