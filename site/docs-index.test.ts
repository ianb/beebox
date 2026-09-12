import assert from "node:assert/strict";
import { test } from "node:test";
import { DocsIndexError, renderAgentLlmsTxt, renderDevLlmsTxt, renderDirectoryIndex } from "./docs-index.js";
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
    hasDevEntry: false,
  });
  assert.match(out, /^# Bee Box\n\n> A one-line summary\.\n\nPreamble body\.\n\n## Start here\n/);
  assert.match(out, /- \[What Bee Box is]\(\/beebox\/docs\/01-what-bee-box-is\.md\): What it is\./);
  assert.match(out, /## Directories\n\n- \[concepts\/]\(\/beebox\/docs\/concepts\/index\.md\): Core vocabulary\./);
  assert.match(out, /## Site pages\n\n- \[Home]\(\/beebox\/index\.md\): The home page\./);
  assert.doesNotMatch(out, /## Contributing/);
});

test("renderAgentLlmsTxt: hasDevEntry adds a Contributing section before Site pages", () => {
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    spine: [],
    directories: [],
    sitePages: [],
    hasDevEntry: true,
  });
  assert.match(
    out,
    /## Contributing\n\n- \[llms-dev\.txt]\(\/beebox\/llms-dev\.txt\): the contributor entry point[^\n]*\n- \[dev\/]\(\/beebox\/docs\/dev\/index\.md\): development process docs\.\n\n## Site pages/,
  );
});

test("renderAgentLlmsTxt: an unlisted site page is excluded", () => {
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    spine: [],
    directories: [],
    sitePages: [{ title: "Prototype", stem: "proto", summary: "s", unlisted: true }],
    hasDevEntry: false,
  });
  assert.doesNotMatch(out, /Prototype/);
});

const ALSO = [
  { dir: "contracts", purpose: "Wire contracts." },
  { dir: "design", purpose: "Design docs." },
  { dir: "reference", purpose: "Engine reference." },
  { dir: "reference/cards", purpose: "Every card type." },
  { dir: "security", purpose: "Security posture." },
  { dir: "concepts", purpose: "Core vocabulary." },
];

test("renderDevLlmsTxt: no start-here — everything sorted under Files, then Also", () => {
  const out = renderDevLlmsTxt({
    base: "/beebox/",
    readme: { summary: "For contributors.", preamble: "Preamble body." },
    startHere: undefined,
    files: [
      doc({ publishPath: "dev/testing.md", description: "How tests work." }),
      doc({ publishPath: "dev/contributing.md", description: "How a change lands." }),
    ],
    also: ALSO,
  });
  assert.match(out, /^# Bee Box for contributors\n\n> For contributors\.\n\nPreamble body\.\n\n## Files\n/);
  assert.doesNotMatch(out, /## Start here/);
  const filesSection = out.split("## Files\n\n")[1]?.split("\n\n## Also")[0];
  assert.equal(
    filesSection,
    "- [contributing.md](/beebox/docs/dev/contributing.md): How a change lands.\n" +
      "- [testing.md](/beebox/docs/dev/testing.md): How tests work.",
  );
  assert.match(out, /## Also\n\n- \[contracts\/]\(\/beebox\/docs\/contracts\/index\.md\): Wire contracts\./);
  assert.match(out, /- \[reference\/cards\/]\(\/beebox\/docs\/reference\/cards\/index\.md\): Every card type\./);
  assert.match(out, /- \[llms\.txt]\(\/beebox\/llms\.txt\): the evaluator-facing index[^\n]*\n?$/);
});

test("renderDevLlmsTxt: start-here orders its files first, the rest fall to Files", () => {
  const out = renderDevLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    startHere: ["contributing.md", "testing.md"],
    files: [
      doc({ publishPath: "dev/architecture.md", description: "How it's built." }),
      doc({ publishPath: "dev/testing.md", description: "How tests work." }),
      doc({ publishPath: "dev/contributing.md", description: "How a change lands." }),
    ],
    also: ALSO,
  });
  const startHereSection = out.split("## Start here\n\n")[1]?.split("\n\n## Files")[0];
  assert.equal(
    startHereSection,
    "- [contributing.md](/beebox/docs/dev/contributing.md): How a change lands.\n" +
      "- [testing.md](/beebox/docs/dev/testing.md): How tests work.",
  );
  const filesSection = out.split("## Files\n\n")[1]?.split("\n\n## Also")[0];
  assert.equal(filesSection, "- [architecture.md](/beebox/docs/dev/architecture.md): How it's built.");
});

test("renderDevLlmsTxt: a start-here filename not published under dev/ fails", () => {
  assert.throws(
    () =>
      renderDevLlmsTxt({
        base: "/beebox/",
        readme: { summary: "s", preamble: "p" },
        startHere: ["missing.md"],
        files: [doc({ publishPath: "dev/contributing.md", description: "x" })],
        also: ALSO,
      }),
    DocsIndexError,
  );
});
