import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DocsLinkError, rewritePromotedImages, rewritePromotedLinks, validateAuthoredLinks } from "./docs-links.js";

function tmpRepoRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "docs-links-"));
}

// --- promoted docs: the four link cases -------------------------------------

test("rewritePromotedLinks: a link into the published set rewrites to a relative published URL", () => {
  const repoRoot = tmpRepoRoot();
  const body = rewritePromotedLinks("see [cards](cards-as-markdown.md) for the format", {
    repoRoot,
    repoDocPath: "beebox/docs/glossary.md",
    manifestByRepoPath: new Map([
      ["beebox/docs/glossary.md", "concepts/glossary.md"],
      ["beebox/docs/cards-as-markdown.md", "concepts/cards.md"],
    ]),
    publishPath: "concepts/glossary.md",
  });
  assert.equal(body, "see [cards](cards.md) for the format");
});

test("rewritePromotedLinks: a link under an excluded root flattens to its text", () => {
  const repoRoot = tmpRepoRoot();
  const body = rewritePromotedLinks("see [the decision](../../issues/decisions/2026-05-21-x.md) for background", {
    repoRoot,
    repoDocPath: "beebox/docs/glossary.md",
    manifestByRepoPath: new Map(),
    publishPath: "concepts/glossary.md",
  });
  assert.equal(body, "see the decision for background");
});

test("rewritePromotedLinks: a tracked repo file rewrites to a GitHub blob URL", () => {
  const repoRoot = tmpRepoRoot();
  fs.mkdirSync(path.join(repoRoot, "beebox", "docs"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "beebox", "docs", "held-back.md"), "held back");
  const body = rewritePromotedLinks("see [held back](held-back.md)", {
    repoRoot,
    repoDocPath: "beebox/docs/glossary.md",
    manifestByRepoPath: new Map(),
    publishPath: "concepts/glossary.md",
  });
  assert.equal(body, "see [held back](https://github.com/ianb/beebox/blob/main/beebox/docs/held-back.md)");
});

test("rewritePromotedLinks: a nonexistent target fails the build", () => {
  const repoRoot = tmpRepoRoot();
  assert.throws(
    () =>
      rewritePromotedLinks("see [gone](nope.md)", {
        repoRoot,
        repoDocPath: "beebox/docs/glossary.md",
        manifestByRepoPath: new Map(),
        publishPath: "concepts/glossary.md",
      }),
    DocsLinkError,
  );
});

test("rewritePromotedLinks: external links and images pass through untouched", () => {
  const repoRoot = tmpRepoRoot();
  const body = rewritePromotedLinks("[site](https://example.com) and ![pic](images/x.png)", {
    repoRoot,
    repoDocPath: "beebox/docs/architecture/01.md",
    manifestByRepoPath: new Map(),
    publishPath: "architecture/01.md",
  });
  assert.equal(body, "[site](https://example.com) and ![pic](images/x.png)");
});

test("rewritePromotedImages: an internal image points at the GitHub-served copy", () => {
  const repoRoot = tmpRepoRoot();
  fs.mkdirSync(path.join(repoRoot, "beebox", "docs", "architecture", "images"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "beebox", "docs", "architecture", "images", "x.png"), "fakepng");
  const out = rewritePromotedImages("see ![pic](images/x.png) and ![ext](https://x.test/y.png)", {
    repoRoot,
    repoDocPath: "beebox/docs/architecture/01.md",
  });
  assert.equal(
    out,
    "see ![pic](https://github.com/ianb/beebox/blob/main/beebox/docs/architecture/images/x.png?raw=true) and ![ext](https://x.test/y.png)",
  );
});

test("rewritePromotedImages: a missing image fails the build", () => {
  const repoRoot = tmpRepoRoot();
  assert.throws(
    () => rewritePromotedImages("![pic](images/missing.png)", { repoRoot, repoDocPath: "beebox/docs/architecture/01.md" }),
    DocsLinkError,
  );
});

// --- authored docs: links must resolve within the published set ------------

test("validateAuthoredLinks: a link within the published set passes", () => {
  assert.doesNotThrow(() =>
    validateAuthoredLinks("see [glossary](concepts/glossary.md)", {
      publishPath: "01-what-bee-box-is.md",
      sourceLabel: "site/docs/01-what-bee-box-is.md",
      publishedPaths: new Set(["concepts/glossary.md"]),
    }),
  );
});

test("validateAuthoredLinks: a link that leaves the published set fails", () => {
  assert.throws(
    () =>
      validateAuthoredLinks("see [nope](concepts/nope.md)", {
        publishPath: "01-what-bee-box-is.md",
        sourceLabel: "site/docs/01-what-bee-box-is.md",
        publishedPaths: new Set(["concepts/glossary.md"]),
      }),
    DocsLinkError,
  );
});

test("validateAuthoredLinks: a relative link resolves against the doc's own directory", () => {
  assert.doesNotThrow(() =>
    validateAuthoredLinks("see [gmail](gmail.md) and [up](../05-how-it-works.md)", {
      publishPath: "capabilities/chat.md",
      sourceLabel: "site/docs/capabilities/chat.md",
      publishedPaths: new Set(["capabilities/gmail.md", "05-how-it-works.md"]),
    }),
  );
});
