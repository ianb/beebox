// # `computeNewSpecifier`: recomputing an import after a move

import { test } from "tap";
import "agent-doctest/tap";
import { computeNewSpecifier } from "../../../../src/dev/layout/move/specifier.js";

const noAliases = { baseDir: "", entries: [] };
const sharedAliases = {
  baseDir: "pkg",
  entries: [{ prefix: "@shared/", suffix: "", hasWildcard: true, targets: ["./src/shared/*"] }],
};

// ## Extension style is preserved: `.js` stays `.js`, extensionless stays extensionless
void test("Extension style is preserved: `.js` stays `.js`, extensionless stays extensionless", async (t) => {
  // doctest:L16
  t.check(
    computeNewSpecifier({
      oldSpecifier: "./b.js",
      newImporterDir: "pkg/src/other",
      newTargetPath: "pkg/src/other/b.ts",
      aliases: noAliases,
    }),
    "./b.js",
  );

  // doctest:L24
  t.check(
    computeNewSpecifier({
      oldSpecifier: "./b",
      newImporterDir: "pkg/src/other",
      newTargetPath: "pkg/src/other/b.ts",
      aliases: noAliases,
    }),
    "./b",
  );
});

// ## An importer moving to another directory recomputes the relative path, adding `./`
void test("An importer moving to another directory recomputes the relative path, adding `./`", async (t) => {
  // doctest:L36
  t.check(
    computeNewSpecifier({
      oldSpecifier: "./b.js",
      newImporterDir: "pkg/src/new-home",
      newTargetPath: "pkg/src/other/b.ts",
      aliases: noAliases,
    }),
    "../other/b.js",
  );
});

// ## A moved `.test.ts` file keeps its `.test` component, not just its real extension
void test("A moved `.test.ts` file keeps its `.test` component, not just its real extension", async (t) => {
  // doctest:L48
  t.check(
    computeNewSpecifier({
      oldSpecifier: "./foo.test.js",
      newImporterDir: "pkg/test",
      newTargetPath: "pkg/test/sub/foo.test.ts",
      aliases: noAliases,
    }),
    "./sub/foo.test.js",
  );
});

// ## An alias specifier recomputes within the alias root when the target stays under it
void test("An alias specifier recomputes within the alias root when the target stays under it", async (t) => {
  // doctest:L60
  t.check(
    computeNewSpecifier({
      oldSpecifier: "@shared/ref-path",
      newImporterDir: "pkg/src/webapp",
      newTargetPath: "pkg/src/shared/paths/ref-path.ts",
      aliases: sharedAliases,
    }),
    "@shared/paths/ref-path",
  );
});

// ## An alias specifier falls back to relative when the target leaves the alias root
void test("An alias specifier falls back to relative when the target leaves the alias root", async (t) => {
  // doctest:L72
  t.check(
    computeNewSpecifier({
      oldSpecifier: "@shared/ref-path",
      newImporterDir: "pkg/src/webapp",
      newTargetPath: "pkg/src/lib/ref-path.ts",
      aliases: sharedAliases,
    }),
    "../lib/ref-path",
  );
});
