// # Scanner: specifier resolution
//
// `resolveImport` resolves a relative or tsconfig-aliased specifier to a
// repo-relative file, checked against the real filesystem; a bare specifier
// that matches no alias is external.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
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

// ## A pure path join, no filesystem involved
void test("A pure path join, no filesystem involved", async (t) => {
  t.check(resolveRepoRelative({ fromDir: "a/b", relative: "../c" }), "a/c");
});

// ## An alias resolves through `baseUrl`/`paths`
void test("An alias resolves through `baseUrl`/`paths`", async (t) => {
  t.check(aliases.baseDir, "pkg");

  t.check(resolveImport({ specifier: "@x/foo", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: "pkg/dir/foo.ts",
    external: false,
  });
});

// ## `.js` swapped for `.ts` when the exact path is absent
void test("`.js` swapped for `.ts` when the exact path is absent", async (t) => {
  t.check(resolveImport({ specifier: "./b.js", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: "pkg/src/b.ts",
    external: false,
  });
});

// ## Appending `/index.ts` when a directory has no extension match
void test("Appending `/index.ts` when a directory has no extension match", async (t) => {
  t.check(resolveImport({ specifier: "./util", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: "pkg/src/util/index.ts",
    external: false,
  });
});

// ## A Vite query suffix (`?url`, `?raw`, ...) is stripped before resolving
void test("A Vite query suffix (`?url`, `?raw`, ...) is stripped before resolving", async (t) => {
  t.check(resolveImport({ specifier: "./b.js?url", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: "pkg/src/b.ts",
    external: false,
  });
});

// ## A relative specifier that resolves to no file on disk
void test("A relative specifier that resolves to no file on disk", async (t) => {
  t.check(resolveImport({ specifier: "./missing.js", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: null,
    external: false,
  });
});

// ## An alias match whose target resolves to no file on disk
void test("An alias match whose target resolves to no file on disk", async (t) => {
  t.check(resolveImport({ specifier: "@x/missing", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: null,
    external: false,
  });
});

// ## A bare specifier matching no alias is external
void test("A bare specifier matching no alias is external", async (t) => {
  t.check(resolveImport({ specifier: "zod", importerPath: "pkg/src/a.ts", repoRoot, aliases }), {
    target: null,
    external: true,
  });
});

// ## No `tsconfig.json`: `baseDir` defaults to the package root, no aliases
void test("No `tsconfig.json`: `baseDir` defaults to the package root, no aliases", async (t) => {
  t.teardown(async () => {
    try {
      t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
    } catch (error) {
      t.error(error);
    }
  });
  const noConfig = loadAliases({ repoRoot, packageRoot: "pkg/dir" });
  t.check(noConfig, { baseDir: "pkg/dir", entries: [] });
});
