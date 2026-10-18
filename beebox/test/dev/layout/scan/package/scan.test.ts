// # Scanner: `scanPackage`
//
// `scanPackage` wires the sibling modules together into one `PackageLayout`
// read from disk: listing, AST parsing and resolution, registry extraction,
// doctest imports, and public surfaces.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ImportEdge, LayoutFile } from "../../../../../src/dev/layout/model.js";
import { scanPackage } from "../../../../../src/dev/layout/scan/package/scan.js";

// Only modules and tests carry import edges.
function importsOf(file: LayoutFile | undefined): ImportEdge[] {
  return file?.kind === "module" || file?.kind === "test" ? file.imports : [];
}

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-scan-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });

await write(
  "pkg/package.json",
  JSON.stringify({ exports: { "./main": "./dist/main.js" } }),
);
await write(
  "pkg/scripts/build.ts",
  "import { build } from \"esbuild\";\nimport { join } from \"node:path\";\nconst root = join(import.meta.dirname, \"..\");\nconst distDir = join(root, \"dist\");\nawait build({\n  entryPoints: [join(root, \"src/a.ts\")],\n  outfile: join(distDir, \"main.js\"),\n});\n",
);
await write("pkg/src/b.ts", "export const b = 1;\n");
await write("pkg/public/sw.js", "self.addEventListener('install', () => {});\n");
await write("pkg/src/shared/registry.ts", "export function defineRegistry(spec: unknown): unknown { return spec; }\n");
await write(
  "pkg/src/a.ts",
  "import { b } from \"./b.js\";\nimport { missing } from \"./missing.js\";\nimport { defineRegistry } from \"./shared/registry.js\";\n\nexport const registry = defineRegistry<number>({\n  directory: \"./commands\",\n  ordered: false,\n  members: [b],\n});\n\nexport const a = 1;\n",
);
await write(
  "pkg/test/x.doctest.md",
  "# X\n\n```ts setup\nimport { a } from \"../src/a.js\";\n```\n\n```ts\na\n=> 1\n```\n",
);

const layout = await scanPackage({ repoRoot, packageRoot: "pkg" });

// ## Files are classified and their facts recorded
void test("Files are classified and their facts recorded", async (t) => {
  // doctest:L56
  t.check(layout.files.get("pkg/src/a.ts")?.kind, "module");

  // doctest:L59
  t.check(layout.files.get("pkg/test/x.doctest.md")?.kind, "test");
});

// `scripts/` holds TypeScript and is an extra source root; `public/` holds
// none, so it is not, and its plain `.js` file is a static asset, not a module.
void test("scripts/ holds TypeScript and is an extra source root; public/ holds none, so...", async (t) => {
  // doctest:L67
  t.check(layout.extraSourceRoots, [
    "pkg/scripts",
  ]);

  // doctest:L70
  t.check(layout.files.get("pkg/public/sw.js")?.kind, "data");
});

// ## Value imports resolve; a registry declaration is read with its member's source
void test("Value imports resolve; a registry declaration is read with its member's source", async (t) => {
  // doctest:L77
  const a = layout.files.get("pkg/src/a.ts");
  t.check(importsOf(a).find((i) => i.specifier === "./b.js"), {
    specifier: "./b.js",
    target: "pkg/src/b.ts",
    external: false,
    typeOnly: false,
    names: [
      "b",
    ],
    dynamic: false,
  });

  // doctest:L81
  t.check(a?.kind === "module" ? a.registries[0] : null, {
    directory: "pkg/src/commands",
    entry: null,
    ordered: false,
    form: "list",
    members: [
      {
        expression: "b",
        source: "pkg/src/b.ts",
        key: null,
      },
    ],
    line: 5,
  });
});

// ## An unresolved import is a scan finding
void test("An unresolved import is a scan finding", async (t) => {
  // doctest:L88
  t.check(layout.scanFindings, [
    {
      rule: "scan",
      path: "pkg/src/a.ts",
      message: "unresolved import ./missing.js",
    },
  ]);
});

// ## A doctest's setup imports are resolved relative to its own directory
void test("A doctest's setup imports are resolved relative to its own directory", async (t) => {
  // doctest:L95
  const doctestFile = layout.files.get("pkg/test/x.doctest.md");
  t.check(importsOf(doctestFile).find((i) => i.specifier === "../src/a.js")?.target, "pkg/src/a.ts");
});

// ## Public surfaces come from `package.json` `exports` and the build entry
void test("Public surfaces come from `package.json` `exports` and the build entry", async (t) => {
  t.teardown(async () => {
    try {
      t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L103
  t.check(layout.publicSurfaces, [
    {
      specifier: "./main",
      target: "pkg/dist/main.js",
      source: "pkg/src/a.ts",
    },
  ]);
});
