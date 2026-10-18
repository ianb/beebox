// # The literal mention forms a move (or directory rename) produces

import { test } from "tap";
import "agent-doctest/tap";
import { fileForms, directoryForms } from "../../../../src/dev/layout/move/mention-forms.js";

const roots = ["pkg", "other-pkg"];

// ## A `.ts` move gets six forms: repo-relative and package-relative, each raw/`.js`/extensionless
void test("A `.ts` move gets six forms: repo-relative and package-relative, each raw/`.js`/extensionless", async (t) => {
  // doctest:L12
  const forms = fileForms({ move: { from: "pkg/src/a.ts", to: "pkg/src/sub/a.ts" }, roots });
  t.check(forms.map((f) => [f.kind, f.old, f.new]), [
    [
      "repo-relative",
      "pkg/src/a.ts",
      "pkg/src/sub/a.ts",
    ],
    [
      "repo-relative",
      "pkg/src/a.js",
      "pkg/src/sub/a.js",
    ],
    [
      "repo-relative",
      "pkg/src/a",
      "pkg/src/sub/a",
    ],
    [
      "package-relative",
      "src/a.ts",
      "src/sub/a.ts",
    ],
    [
      "package-relative",
      "src/a.js",
      "src/sub/a.js",
    ],
    [
      "package-relative",
      "src/a",
      "src/sub/a",
    ],
  ]);

  // doctest:L16
  await t.checkText(forms.every((f) => f.kind !== "package-relative" || f.scopeRoot === "pkg"), "true");
});

// ## A non-module move (no real extension swap) gets only the raw repo-relative and package-relative forms
void test("A non-module move (no real extension swap) gets only the raw repo-relative and package-relative forms", async (t) => {
  // doctest:L23
  const jsonForms = fileForms({ move: { from: "pkg/data/x.json", to: "pkg/data/y/x.json" }, roots });
  t.check(jsonForms.map((f) => [f.kind, f.old, f.new]), [
    [
      "repo-relative",
      "pkg/data/x.json",
      "pkg/data/y/x.json",
    ],
    [
      "package-relative",
      "data/x.json",
      "data/y/x.json",
    ],
  ]);
});

// ## A move that crosses package roots has no package-relative form (the two sides don't share a root to be relative to)
void test("A move that crosses package roots has no package-relative form (the two sides don't share a root to be relative to)", async (t) => {
  // doctest:L31
  const crossPkg = fileForms({ move: { from: "pkg/src/a.ts", to: "other-pkg/src/a.ts" }, roots });
  await t.checkText(crossPkg.every((f) => f.kind === "repo-relative"), "true");
});

// ## Directory forms have no extension, so just the two raw forms
void test("Directory forms have no extension, so just the two raw forms", async (t) => {
  // doctest:L39
  const dirForms = directoryForms({ rename: { from: "pkg/src/old-dir", to: "pkg/src/new-dir" }, roots });
  t.check(dirForms.map((f) => [f.kind, f.old, f.new, f.scopeRoot]), [
    [
      "directory-repo-relative",
      "pkg/src/old-dir",
      "pkg/src/new-dir",
      null,
    ],
    [
      "directory-package-relative",
      "src/old-dir",
      "src/new-dir",
      "pkg",
    ],
  ]);
});
