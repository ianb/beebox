# Typechecking doctests

tsx strips types without checking them, so a doctest that calls an API with
the wrong argument type fails only when it runs. `typecheckDoctests` checks
the module the loader generates from each `.doctest.md`, under a tsconfig the
caller names, and reports each error on the markdown line.

Each example below writes a small package to a temporary directory: a strict
tsconfig, one source module, and the doctests to check. The package links
the `node_modules` that holds `tap` and `@types/node` for this checkout, so
they resolve as they do in a real consumer.

```ts setup
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { typecheckDoctests } from "../src/typecheck/check.ts";

const nodeModules = dirname(dirname(dirname(createRequire(import.meta.url).resolve("@types/node/package.json"))));
const roots: string[] = [];

/** A package with `src/math.ts` and the given doctests; returns the summary of checking them. */
function check(doctests: Record<string, string>, compilerOptions: Record<string, unknown> = {}): string[] {
  const root = mkdtempSync(join(tmpdir(), "doctest-typecheck-"));
  roots.push(root);
  symlinkSync(nodeModules, join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      types: ["node"], rootDir: "src", outDir: "dist", ...compilerOptions,
    },
    include: ["src/**/*"],
  }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/math.ts"), [
    "export interface Point { x: number; y: number }",
    "export function add(a: number, b: number): number { return a + b; }",
  ].join("\n"));
  mkdirSync(join(root, "test"));
  const files = Object.entries(doctests).map(([name, text]) => {
    const file = join(root, "test", name);
    writeFileSync(file, text);
    return file;
  });
  return typecheckDoctests({ tsconfig: join(root, "tsconfig.json"), files })
    .map((d) => `${basename(d.file)}:${d.line}:${d.column} ${d.code} ${d.message.split("\n")[0] ?? ""}`);
}

const fence = "```";
```

```ts teardown
for (const root of roots) rmSync(root, { recursive: true, force: true });
```

A correct doctest has no errors, though the package's `rootDir` does not
contain `test/`: only emit settings are dropped, never checking options.

```ts
check({
  "ok.doctest.md": [
    `${fence}ts setup`,
    'import { add } from "../src/math.js";',
    fence,
    "",
    `${fence}ts`,
    "add(1, 2)",
    "=> 3",
    fence,
  ].join("\n"),
})
=> []
```

A wrong argument is reported on its markdown line and column. The column
counts from the start of the author's line, not from the indent the
generator adds.

```ts
check({
  "wrong.doctest.md": [
    `${fence}ts setup`,
    'import { add } from "../src/math.js";',
    fence,
    "",
    `${fence}ts`,
    'add(1, "2")',
    "=> 3",
    fence,
  ].join("\n"),
})
=> ["wrong.doctest.md:6:8 TS2345 Argument of type 'string' is not assignable to parameter of type 'number'."]
```

A `continue` block shares the previous block's scope, so its names resolve.
An `import type` in an example block, which the run erases, is hoisted for the
check, so the type is known.

```ts
check({
  "scope.doctest.md": [
    `${fence}ts`,
    'import type { Point } from "../src/math.js";',
    "const p: Point = { x: 1, y: 2 };",
    "p.x",
    "=> 1",
    fence,
    "",
    `${fence}ts continue`,
    "p.y",
    "=> 2",
    fence,
  ].join("\n"),
})
=> []
```

A hoisted import is one line per bound name, on the line that names it, so a
multi-line `import type` puts an error on the right line and keeps every later
line on its markdown line. Two blocks that import the same type, in different
statements or quotes, bind it once.

```ts
check({
  "hoist.doctest.md": [
    `${fence}ts`,
    "import type {",
    "  Point,",
    "  Nope,",
    '} from "../src/math.js";',
    'const p: Point = { x: 1, y: "2" };',
    "p.x",
    "=> 1",
    fence,
    "",
    `${fence}ts`,
    "import type { Point, Point as P } from '../src/math.js';",
    "const q: P = { x: 3, y: 4 };",
    "q.x",
    "=> 3",
    fence,
  ].join("\n"),
})
=> [
  "hoist.doctest.md:4:3 TS2305 Module '\"../src/math.js\"' has no exported member 'Nope'.",
  "hoist.doctest.md:6:26 TS2322 Type 'string' is not assignable to type 'number'."
]
```

`t`, `print`, and `eventually` are bound for every test whether it uses them
or not. Under `noUnusedLocals` those generated bindings are not reported; an
unused name the author declares is.

```ts
check({
  "unused.doctest.md": [
    `${fence}ts`,
    "const unused = 1;",
    "1 + 1",
    "=> 2",
    fence,
  ].join("\n"),
}, { noUnusedLocals: true })
=> ["unused.doctest.md:2:7 TS6133 'unused' is declared but its value is never read."]
```

A doctest the loader cannot generate is reported with code `doctest` on the
line the loader names.

```ts
check({
  "broken.doctest.md": [
    `${fence}ts continue`,
    "1",
    "=> 1",
    fence,
  ].join("\n"),
})
=> ["broken.doctest.md:1:1 doctest a ```ts continue block has no open test to continue — it would silently become a new test. Make the first example block a plain ```ts block."]
```
