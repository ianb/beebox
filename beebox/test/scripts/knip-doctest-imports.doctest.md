# Reading doctest imports for knip

Knip enforces "only export what's needed", and doctests are a large share of
what needs things. Knip parses TypeScript, not markdown, so `doctestImports`
is the compiler that lets it see a `.doctest.md` file's edges into `src/`.

A miss here is expensive in one direction: an import this function fails to
report makes a live export look dead, and the `exports` check deletes it.

```ts setup
import { doctestImports } from "../../scripts/knip-doctest-imports.js";
import { readFile, glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// A literal fence can't appear inside this file's own fences.
const TICKS = "```";

/** Wrap lines in a markdown code fence with the given info string. */
const fence = (info: string, ...lines: string[]): string =>
  [`${TICKS}${info}`, ...lines, TICKS].join("\n");
```

## Static imports come through verbatim

```ts
doctestImports(fence("ts setup", 'import { loadBox } from "../../src/core/box/index.js";'))
=> import { loadBox } from "../../src/core/box/index.js";
```

The multi-line named form is one statement, not several:

```ts continue
const multi = fence("ts", "import {", "  alpha,", "  beta,", '} from "./m.js";');
doctestImports(multi).split("\n").length
=> 1

doctestImports(multi).includes("alpha") && doctestImports(multi).includes("beta")
=> true
```

## Dynamic imports become static ones

Doctests reach into `src/` mid-fence with `await import(...)` — usually to load
a module only after a fixture exists. Knip would see an opaque module
reference, so the named bindings get rewritten into an import clause:

```ts continue
doctestImports(fence("ts", 'const { loadBoxConfig } = await import("../../src/core/box/index.js");'))
=> import { loadBoxConfig } from "../../src/core/box/index.js";
```

A renamed binding keeps the *exported* name, which is the one knip matches
against — `tpl3` is local and tells knip nothing:

```ts continue
doctestImports(fence("ts", 'const { createGsheetTemplate: tpl3 } = await import("../../src/schemas/gsheet.js");'))
=> import { createGsheetTemplate as tpl3 } from "../../src/schemas/gsheet.js";
```

The whole-module form becomes a namespace import:

```ts continue
doctestImports(fence("ts", 'const widgets = await import("beebox/view-widgets");'))
=> import * as widgets from "beebox/view-widgets";
```

## Everything outside a TS fence is dropped

Prose is not code. An import-shaped sentence in the narrative must not
manufacture an edge, or a genuinely dead export stays alive forever:

```ts continue
JSON.stringify(doctestImports('We import { ghost } from "./nowhere.js" in the older flow.'))
=> ""
```

Neither do non-TS fences:

```ts continue
JSON.stringify(doctestImports(fence("bash", 'import { ghost } from "./nowhere.js"')))
=> ""
```

Fence bodies are snippets rather than programs, so nothing but the imports
survives — no assertion, no fixture, no `=> value` line:

```ts continue
const mixed = [
  fence("ts setup", 'import { sum } from "./m.js";'),
  "",
  fence("ts", "sum(1, 2)", "=> 3"),
].join("\n");
doctestImports(mixed)
=> import { sum } from "./m.js";
```

## The real corpus

Run against the suite itself, the reader finds thousands of edges, and every
one of them is a well-formed import statement:

```ts continue
const testDir = fileURLToPath(new URL("..", import.meta.url));
const found: string[] = [];
for await (const entry of glob("**/*.doctest.md", { cwd: testDir })) {
  const text = await readFile(`${testDir}${entry}`, "utf-8");
  found.push(...doctestImports(text).split("\n").filter(Boolean));
}

found.length > 1000
=> true

found.every((line) => /^import[\s*{]/.test(line))
=> true

found.some((line) => line.includes("../../src/"))
=> true
```
