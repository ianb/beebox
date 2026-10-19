// # doc-link-repair: basename-based markdown-link repair
//
// The fixable half of doc-link decay. When a file moves, relative links to it
// break; where its basename is unique repo-wide, the current location is
// recoverable, so the broken link can be rewritten. Pure logic (fs/git injected).

import { test } from "tap";
import "agent-doctest/tap";
import { repairFrontmatterPaths, repairLinks, duplicateBasenames, buildBasenameLookup } from "../../../src/dev/doc-check/link-repair.js";

// A tiny fake tree: bugs/foo.md has moved to closed/bugs/foo.md.
const files = ["issues/closed/bugs/foo.md", "issues/features/bar.md", "beebox/docs/guide.md"];
const exists = (p: string) => files.includes(p);
const lookup = buildBasenameLookup(files);
const repair = (fromRel: string, content: string) => repairLinks({ fromRel, content, fileExists: exists, basenameLookup: lookup });
const repairFrontmatter = (fromRel: string, content: string) => repairFrontmatterPaths({ fromRel, content, fileExists: exists, basenameLookup: lookup });

// ## A stale link is rewritten to the file's current location
void test("A stale link is rewritten to the file's current location", async (t) => {
  // doctest:L21
  const r = repair("issues/features/bar.md", "see [foo](../bugs/foo.md) for context");
  t.check(r.content, "see [foo](../closed/bugs/foo.md) for context");

  // doctest:L25
  t.check(r.rewrites, [
    {
      line: 1,
      from: "../bugs/foo.md",
      to: "../closed/bugs/foo.md",
    },
  ]);
});

// ## Frontmatter scalar and list paths use the same repair contract
void test("Frontmatter scalar and list paths use the same repair contract", async (t) => {
  // doctest:L32
  const fm = repairFrontmatter("issues/features/bar.md", `---
title: Bar
design: ../../beebox/old/guide.md
issues:
  - ../bugs/foo.md
---
# Bar`);
  await t.checkText(fm.content, `---
title: Bar
design: ../../beebox/docs/guide.md
issues:
  - ../closed/bugs/foo.md
---
# Bar`);

  // doctest:L48
  t.check(fm.rewrites, [
    {
      line: 3,
      from: "../../beebox/old/guide.md",
      to: "../../beebox/docs/guide.md",
    },
    {
      line: 5,
      from: "../bugs/foo.md",
      to: "../closed/bugs/foo.md",
    },
  ]);
});

// ## A link that already resolves is left untouched (anchor preserved)
void test("A link that already resolves is left untouched (anchor preserved)", async (t) => {
  // doctest:L55
  const ok = repair("issues/features/bar.md", "[foo](../closed/bugs/foo.md#section)");
  t.check(ok, { content: "[foo](../closed/bugs/foo.md#section)", rewrites: [], unfixable: [] });
});

// ## An unfixable link (true rename/delete) is reported, never guessed
void test("An unfixable link (true rename/delete) is reported, never guessed", async (t) => {
  // doctest:L66
  const gone = repair("issues/features/bar.md", "[x](../bugs/deleted-thing.md)");
  t.check(gone, {
    content: "[x](../bugs/deleted-thing.md)",
    rewrites: [],
    unfixable: [
      {
        line: 1,
        target: "../bugs/deleted-thing.md",
        reason: "no-basename-match",
      },
    ],
  });
});

// ## Links inside inline code are left alone (they illustrate syntax)
void test("Links inside inline code are left alone (they illustrate syntax)", async (t) => {
  // doctest:L77
  const inline = repair("issues/features/bar.md", "the form is `[foo](../bugs/foo.md)` — a cross-link");
  t.check(inline, { content: "the form is `[foo](../bugs/foo.md)` — a cross-link", rewrites: [], unfixable: [] });
});

// ## Links inside a fenced code block are left alone
void test("Links inside a fenced code block are left alone", async (t) => {
  // doctest:L88
  const fence = "`".repeat(3);
  const fenced = repair("issues/features/bar.md", fence + "\n[foo](../bugs/foo.md)\n" + fence);
  t.check(fenced, { content: fence + "\n[foo](../bugs/foo.md)\n" + fence, rewrites: [], unfixable: [] });
});

// ## An ambiguous basename (2+ candidates) is guarded, not rewritten
void test("An ambiguous basename (2+ candidates) is guarded, not rewritten", async (t) => {
  // doctest:L97
  const amb = repairLinks({ fromRel: "docs/a.md", content: "[x](./missing/x.md)", fileExists: () => false, basenameLookup: buildBasenameLookup(["p/x.md", "q/x.md"]) });
  t.check(amb, {
    content: "[x](./missing/x.md)",
    rewrites: [],
    unfixable: [
      {
        line: 1,
        target: "./missing/x.md",
        reason: "ambiguous-basename",
      },
    ],
  });
});

// ## Whitelisted one-per-directory basenames are never auto-resolved
void test("Whitelisted one-per-directory basenames are never auto-resolved", async (t) => {
  // doctest:L105
  const readme = repairLinks({ fromRel: "docs/a.md", content: "[r](./missing/README.md)", fileExists: () => false, basenameLookup: buildBasenameLookup(["x/README.md"]) });
  t.check(readme, {
    content: "[r](./missing/README.md)",
    rewrites: [],
    unfixable: [{ line: 1, target: "./missing/README.md", reason: "non-unique-basename" }],
  });
});

// ## duplicateBasenames flags shared basenames, excluding the whitelist
void test("duplicateBasenames flags shared basenames, excluding the whitelist", async (t) => {
  // doctest:L113
  t.check(duplicateBasenames(["issues/bugs/x.md", "issues/closed/bugs/x.md"]).get("x.md"), [
    "issues/bugs/x.md",
    "issues/closed/bugs/x.md",
  ]);

  // doctest:L116
  // README.md / AGENTS.md are intentionally one-per-dir — never counted as duplicates.
  t.check(duplicateBasenames(["a/README.md", "b/README.md", "c/dup.md", "d/dup.md"]), new Map([["dup.md", ["c/dup.md", "d/dup.md"]]]));
});
