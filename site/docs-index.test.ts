import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAgentLlmsTxt, renderDirectoryIndex } from "./docs-index.js";
import type { PublishedDoc } from "./docs-types.js";

function doc(params: { publishPath: string; description: string; body?: string }): PublishedDoc {
  const { publishPath, description } = params;
  const body = params.body ?? "body";
  return { publishPath, kind: "authored", description, body, sourceLabel: publishPath };
}

test("renderDirectoryIndex: H1, purpose line, entries sorted by filename", () => {
  const rendered = renderDirectoryIndex({
    dir: "concepts",
    purpose: "Core vocabulary.",
    docs: [
      doc({ publishPath: "concepts/glossary.md", description: "terms" }),
      doc({ publishPath: "concepts/cards.md", description: "the card format" }),
    ],
  });
  assert.equal(
    rendered,
    "# Concepts\n\nCore vocabulary.\n\n- [cards.md](cards.md): the card format\n- [glossary.md](glossary.md): terms\n",
  );
});

test("renderDirectoryIndex: nested directory humanizes its last segment", () => {
  const rendered = renderDirectoryIndex({ dir: "reference/cards", purpose: "Every card type.", docs: [] });
  assert.match(rendered, /^# Cards\n/);
});

test("renderAgentLlmsTxt: shape has the summary, preamble, spine, directories, and site pages", () => {
  const spine = [
    doc({ publishPath: "01-what-bee-box-is.md", description: "What it is.", body: "# What Bee Box is\n\nBody text." }),
  ];
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "A one-line summary.", preamble: "Preamble body." },
    spine,
    directories: [{ dir: "concepts", purpose: "Core vocabulary." }],
    sitePages: [{ title: "Home", stem: "index", summary: "The home page.", unlisted: false }],
  });
  assert.match(out, /^# Bee Box\n\n> A one-line summary\.\n\nPreamble body\.\n\n## Start here\n/);
  assert.match(out, /- \[What Bee Box is]\(\/beebox\/docs\/01-what-bee-box-is\.md\): What it is\./);
  assert.match(out, /## Directories\n\n- \[concepts\/]\(\/beebox\/docs\/concepts\/index\.md\): Core vocabulary\./);
  assert.match(out, /## Site pages\n\n- \[Home]\(\/beebox\/index\.md\): The home page\./);
});

test("renderAgentLlmsTxt: an unlisted site page is excluded", () => {
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    spine: [],
    directories: [],
    sitePages: [{ title: "Prototype", stem: "proto", summary: "s", unlisted: true }],
  });
  assert.doesNotMatch(out, /Prototype/);
});
