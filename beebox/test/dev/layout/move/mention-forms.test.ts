// # The literal mention forms a move (or directory rename) produces

import { test } from "tap";
import "agent-doctest/tap";
import { fileForms, directoryForms } from "../../../../src/dev/layout/move/mention-forms.js";

const roots = ["pkg", "other-pkg"];

// ## A `.ts` move gets six forms: repo-relative and package-relative, each raw/`.js`/extensionless
void test("A `.ts` move gets six forms: repo-relative and package-relative, each raw/`.js`/extensionless", async (t) => {
  // doctest:L12
  const forms = fileForms({ move: { from: "pkg/src/a.ts", to: "pkg/src/sub/a.ts" }, roots });
  t.check(forms, [
    {
      old: "pkg/src/a.ts",
      new: "pkg/src/sub/a.ts",
      kind: "repo-relative",
      scopeRoot: null,
    },
    {
      old: "pkg/src/a.js",
      new: "pkg/src/sub/a.js",
      kind: "repo-relative",
      scopeRoot: null,
    },
    {
      old: "pkg/src/a",
      new: "pkg/src/sub/a",
      kind: "repo-relative",
      scopeRoot: null,
    },
    {
      old: "src/a.ts",
      new: "src/sub/a.ts",
      kind: "package-relative",
      scopeRoot: "pkg",
    },
    {
      old: "src/a.js",
      new: "src/sub/a.js",
      kind: "package-relative",
      scopeRoot: "pkg",
    },
    {
      old: "src/a",
      new: "src/sub/a",
      kind: "package-relative",
      scopeRoot: "pkg",
    },
  ]);
});

// ## A non-module move (no real extension swap) gets only the raw repo-relative and package-relative forms
void test("A non-module move (no real extension swap) gets only the raw repo-relative and package-relative forms", async (t) => {
  // doctest:L23
  const jsonForms = fileForms({ move: { from: "pkg/data/x.json", to: "pkg/data/y/x.json" }, roots });
  t.check(jsonForms, [
    {
      old: "pkg/data/x.json",
      new: "pkg/data/y/x.json",
      kind: "repo-relative",
      scopeRoot: null,
    },
    {
      old: "data/x.json",
      new: "data/y/x.json",
      kind: "package-relative",
      scopeRoot: "pkg",
    },
  ]);
});

// ## A move that crosses package roots has no package-relative form (the two sides don't share a root to be relative to)
void test("A move that crosses package roots has no package-relative form (the two sides don't share a root to be relative to)", async (t) => {
  // doctest:L31
  const crossPkg = fileForms({ move: { from: "pkg/src/a.ts", to: "other-pkg/src/a.ts" }, roots });
  t.check(crossPkg, [
    {
      old: "pkg/src/a.ts",
      new: "other-pkg/src/a.ts",
      kind: "repo-relative",
      scopeRoot: null,
    },
    {
      old: "pkg/src/a.js",
      new: "other-pkg/src/a.js",
      kind: "repo-relative",
      scopeRoot: null,
    },
    {
      old: "pkg/src/a",
      new: "other-pkg/src/a",
      kind: "repo-relative",
      scopeRoot: null,
    },
  ]);
});

// ## Directory forms have no extension, so just the two raw forms
void test("Directory forms have no extension, so just the two raw forms", async (t) => {
  // doctest:L39
  const dirForms = directoryForms({ rename: { from: "pkg/src/old-dir", to: "pkg/src/new-dir" }, roots });
  t.check(dirForms, [
    {
      old: "pkg/src/old-dir",
      new: "pkg/src/new-dir",
      kind: "directory-repo-relative",
      scopeRoot: null,
    },
    {
      old: "src/old-dir",
      new: "src/new-dir",
      kind: "directory-package-relative",
      scopeRoot: "pkg",
    },
  ]);
});
