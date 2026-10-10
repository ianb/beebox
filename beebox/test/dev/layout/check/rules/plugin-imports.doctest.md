# Plugin imports rule

`pluginImportsRule` fences `src/plugins/<name>/` (`docs/plans/plugins.md`,
Track 1): a plugin file imports only `src/exports/*`,
`src/cards/plugin-definition.ts`, its own directory, and packages; the view
module (`view.tsx`) and every own module it reaches import no Node builtin.
The fixture is a real package scanned from disk, so import resolution is the
scanner's, not a hand-built edge list.

```ts setup
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanPackage } from "../../../../../src/dev/layout/scan/package/scan.js";
import { pluginImportsRule } from "../../../../../src/dev/layout/check/rules/plugin-imports.js";
import { summary } from "./fixture.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-plugin-imports-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
await write("pkg/package.json", JSON.stringify({ name: "pkg" }));
await write("pkg/src/cards/plugin-definition.ts", "export interface PluginDefinition { name: string }\n");
await write("pkg/src/exports/cards.ts", "export const cardSchema = 1;\n");
await write("pkg/src/core/thing.ts", "export const thing = 1;\n");
await write("pkg/src/lib/x.ts", "export type X = number;\n");

// A compliant plugin: the public card layer, the contract, its own files, packages.
await write(
  "pkg/src/plugins/good/plugin.ts",
  `import { cardSchema } from "../../exports/cards.js";\nimport type { PluginDefinition } from "../../cards/plugin-definition.js";\nimport { base } from "./schemas.js";\nimport { z } from "zod";\nexport default { cardSchema, base, z } as unknown as PluginDefinition;\n`,
);
await write("pkg/src/plugins/good/schemas.ts", `import { cardSchema } from "../../exports/cards.js";\nexport const base = cardSchema;\n`);
await write(
  "pkg/src/plugins/good/view.tsx",
  `import { useState } from "react";\nimport { Markdown } from "beebox/view-widgets";\nimport { base } from "./schemas.js";\nexport default function View() { useState(base); return <Markdown />; }\n`,
);
await write("pkg/src/plugins/good/README.md", "# good\n");

// A plugin reaching into the engine and a sibling, with a view graph that touches Node.
await write(
  "pkg/src/plugins/bad/plugin.ts",
  `import { thing } from "../../core/thing.js";\nimport type { X } from "../../lib/x.js";\nimport other from "../good/plugin.js";\nexport default { thing, other } as unknown as X;\n`,
);
await write("pkg/src/plugins/bad/view.tsx", `import { readFileSync } from "node:fs";\nimport { helper } from "./helper.js";\nexport default () => helper(readFileSync);\n`);
await write("pkg/src/plugins/bad/helper.ts", `import { existsSync } from "fs";\nimport { z } from "zod";\nexport const helper = (f: unknown) => [existsSync, z, f];\n`);
// A Node import outside the view graph is allowed: plugin.ts runs in Node.
await write("pkg/src/plugins/bad/health.ts", `import { readdir } from "node:fs/promises";\nexport const health = readdir;\n`);

const layout = await scanPackage({ repoRoot, packageRoot: "pkg" });
const findings = pluginImportsRule.check(layout);
```

The compliant plugin has no finding; a file outside `src/plugins/` is never
in scope.

```ts
findings.filter((f) => f.path.includes("/good/")).length
=> 0
```

The engine import, the type-only engine import, and the sibling plugin are
each flagged on `plugin.ts`; the view module and the helper it reaches are
flagged for their builtins, spelled `node:fs` or bare `fs` alike; `health.ts`
imports Node but is not in the view graph, so it is clean.

```ts
summary(findings)
=>
plugin-imports pkg/src/plugins/bad/helper.ts
plugin-imports pkg/src/plugins/bad/plugin.ts
plugin-imports pkg/src/plugins/bad/plugin.ts
plugin-imports pkg/src/plugins/bad/plugin.ts
plugin-imports pkg/src/plugins/bad/view.tsx

findings.filter((f) => f.path.endsWith("/plugin.ts")).map((f) => f.message)
=>
[
  "imports pkg/src/core/thing.ts from plugin \"bad\"; a plugin file imports only pkg/src/exports/*, pkg/src/cards/plugin-definition.ts, its own directory, and packages",
  "imports pkg/src/lib/x.ts from plugin \"bad\"; a plugin file imports only pkg/src/exports/*, pkg/src/cards/plugin-definition.ts, its own directory, and packages",
  "imports pkg/src/plugins/good/plugin.ts from plugin \"bad\"; a plugin file imports only pkg/src/exports/*, pkg/src/cards/plugin-definition.ts, its own directory, and packages",
]

findings.filter((f) => !f.path.endsWith("/plugin.ts")).map((f) => f.message)
=>
[
  "imports the Node builtin fs in plugin \"bad\"'s view graph; view.tsx and what it reaches are bundled for the browser",
  "imports the Node builtin node:fs in plugin \"bad\"'s view graph; view.tsx and what it reaches are bundled for the browser",
]
```

```ts teardown
await rm(repoRoot, { recursive: true, force: true });
```
