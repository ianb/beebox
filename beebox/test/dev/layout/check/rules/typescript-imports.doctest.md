# TypeScript imports rule

`typescriptImportsRule` keeps the TypeScript compiler behind
`src/lib/typescript/` (`docs/implemented-plans/typescript-7.md`, Track C): no other module
or `.test.ts` imports `typescript`, `@typescript/native`, or a subpath of
either, type-only imports included, in the package named `beebox`. Doctests are
exempt. The fixture is a real package scanned from disk, so import resolution is the scanner's.

```ts setup
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanPackage } from "../../../../../src/dev/layout/scan/package/scan.js";
import { typescriptImportsRule } from "../../../../../src/dev/layout/check/rules/typescript-imports.js";
import { summary } from "./fixture.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-typescript-imports-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
await write("beebox/package.json", JSON.stringify({ name: "beebox" }));
await write("beebox/src/lib/typescript/syntax.ts", `import ts from "@typescript/native";\nimport type { Node } from "typescript";\nexport const syntax = [ts, undefined as Node | undefined];\n`);
await write("beebox/src/dev/old.ts", `import ts from "typescript";\nexport const old = ts;\n`);
await write("beebox/src/dev/native.ts", `import type { Thing } from "@typescript/native/unstable/ast";\nexport type Native = Thing;\n`);
await write("beebox/src/dev/other.ts", `import { z } from "zod";\nexport const other = z;\n`);

const layout = await scanPackage({ repoRoot, packageRoot: "beebox" });
const findings = typescriptImportsRule.check(layout);
```

A file outside `src/lib/typescript/` that imports `typescript` or a subpath of
`@typescript/native` is flagged once, type-only imports included. The boundary
directory and an unrelated package are clean.

```ts
summary(findings)
=>
typescript-imports beebox/src/dev/native.ts
typescript-imports beebox/src/dev/old.ts

findings.map((f) => f.message)
=>
[
  "imports @typescript/native/unstable/ast; use beebox/src/lib/typescript/ (the one TypeScript 7 boundary; see docs/implemented-plans/typescript-7.md)",
  "imports typescript; use beebox/src/lib/typescript/ (the one TypeScript 7 boundary; see docs/implemented-plans/typescript-7.md)",
]
```

```ts teardown
await rm(repoRoot, { recursive: true, force: true });
```
