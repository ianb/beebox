import assert from "node:assert/strict";
import { test } from "node:test";
import { DocsIndexError, renderAgentLlmsTxt, renderDirectoryIndex, renderEntryLlmsTxt } from "./docs-index.js";
import type { PublishedDoc } from "./docs-types.js";

function doc(params: { publishPath: string; description: string; body?: string }): PublishedDoc {
  const { publishPath, description } = params;
  const body = params.body ?? "body";
  return { publishPath, kind: "authored", description, body, sourceLabel: publishPath };
}

test("renderDirectoryIndex: H1, purpose line, entries sorted by filename, absolute URLs", () => {
  const rendered = renderDirectoryIndex({
    dir: "concepts",
    purpose: "Core vocabulary.",
    docs: [
      doc({ publishPath: "concepts/glossary.md", description: "terms" }),
      doc({ publishPath: "concepts/cards.md", description: "the card format" }),
    ],
    base: "/beebox/",
  });
  assert.equal(
    rendered,
    "# Concepts\n\nCore vocabulary.\n\n" +
      "- [cards.md](http://localhost:3210/beebox/docs/concepts/cards.md): the card format\n" +
      "- [glossary.md](http://localhost:3210/beebox/docs/concepts/glossary.md): terms\n",
  );
});

test("renderDirectoryIndex: nested directory humanizes its last segment", () => {
  const rendered = renderDirectoryIndex({ dir: "reference/cards", purpose: "Every card type.", docs: [], base: "/beebox/" });
  assert.match(rendered, /^# Cards\n/);
});

test("renderDirectoryIndex: the canonical base uses the beebox.run origin", () => {
  const rendered = renderDirectoryIndex({
    dir: "concepts",
    purpose: "Core vocabulary.",
    docs: [doc({ publishPath: "concepts/glossary.md", description: "terms" })],
    base: "/",
  });
  assert.match(rendered, /\[glossary\.md]\(https:\/\/beebox\.run\/docs\/concepts\/glossary\.md\)/);
});

test("renderAgentLlmsTxt: summary, preamble, spine, then one deep section per directory", () => {
  const spine = [
    doc({ publishPath: "01-what-bee-box-is.md", description: "What it is.", body: "# What Bee Box is\n\nBody text." }),
  ];
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "A one-line summary.", preamble: "Preamble body." },
    spine,
    directories: [
      {
        dir: "concepts",
        purpose: "Core vocabulary.",
        docs: [doc({ publishPath: "concepts/glossary.md", description: "terms", body: "# Glossary\n\nx" })],
      },
    ],
    installDir: undefined,
    devDir: undefined,
    sitePages: [{ title: "Home", href: "http://localhost:3210/index.html", summary: "The home page.", unlisted: false }],
  });
  assert.match(out, /^# Bee Box\n\n> A one-line summary\.\n\nPreamble body\.\n\n## Start here\n/);
  assert.match(out, /- \[What Bee Box is]\(http:\/\/localhost:3210\/beebox\/docs\/01-what-bee-box-is\.md\): What it is\./);
  assert.match(
    out,
    /## concepts\/\n\nCore vocabulary\.\n\n- \[Glossary]\(http:\/\/localhost:3210\/beebox\/docs\/concepts\/glossary\.md\): terms\n/,
  );
  assert.match(out, /## Site pages\n\n- \[Home]\(http:\/\/localhost:3210\/index\.html\): The home page\./);
  assert.doesNotMatch(out, /## Install/);
  assert.doesNotMatch(out, /## Contributing/);
});

test("renderAgentLlmsTxt: installDir/devDir add pointer sections, not a full listing", () => {
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    spine: [],
    directories: [],
    installDir: { dir: "install", purpose: "Getting a box running." },
    devDir: { dir: "dev", purpose: "Contributor process docs." },
    sitePages: [],
  });
  assert.match(
    out,
    /## Install\n\n- \[install\/]\(http:\/\/localhost:3210\/beebox\/docs\/install\/index\.md\): Getting a box running\.\n- \[llms-install\.txt]\(http:\/\/localhost:3210\/beebox\/llms-install\.txt\)/,
  );
  assert.match(
    out,
    /## Contributing\n\n- \[dev\/]\(http:\/\/localhost:3210\/beebox\/docs\/dev\/index\.md\): Contributor process docs\.\n- \[llms-dev\.txt]/,
  );
});

test("renderAgentLlmsTxt: an unlisted site page is excluded", () => {
  const out = renderAgentLlmsTxt({
    base: "/beebox/",
    readme: { summary: "s", preamble: "p" },
    spine: [],
    directories: [],
    installDir: undefined,
    devDir: undefined,
    sitePages: [{ title: "Prototype", href: "http://localhost:3210/proto.html", summary: "s", unlisted: true }],
  });
  assert.doesNotMatch(out, /Prototype/);
});

test("renderAgentLlmsTxt: the canonical base uses the beebox.run origin", () => {
  const out = renderAgentLlmsTxt({
    base: "/",
    readme: { summary: "s", preamble: "p" },
    spine: [],
    directories: [{ dir: "concepts", purpose: "Core vocabulary.", docs: [doc({ publishPath: "concepts/glossary.md", description: "terms" })] }],
    installDir: undefined,
    devDir: undefined,
    sitePages: [],
  });
  assert.match(out, /\[glossary\.md]\(https:\/\/beebox\.run\/docs\/concepts\/glossary\.md\): terms\n/);
});

const ALSO = [
  { dir: "contracts", purpose: "Wire contracts." },
  { dir: "design", purpose: "Design docs." },
  { dir: "reference", purpose: "Engine reference." },
  { dir: "reference/cards", purpose: "Every card type." },
  { dir: "security", purpose: "Security posture." },
  { dir: "concepts", purpose: "Core vocabulary." },
];

test("renderEntryLlmsTxt: no start-here — everything sorted under Files, then Also", () => {
  const out = renderEntryLlmsTxt({
    base: "/beebox/",
    title: "Bee Box for contributors",
    dirName: "dev",
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
    "- [contributing.md](http://localhost:3210/beebox/docs/dev/contributing.md): How a change lands.\n" +
      "- [testing.md](http://localhost:3210/beebox/docs/dev/testing.md): How tests work.",
  );
  assert.match(out, /## Also\n\n- \[contracts\/]\(http:\/\/localhost:3210\/beebox\/docs\/contracts\/index\.md\): Wire contracts\./);
  assert.match(out, /- \[reference\/cards\/]\(http:\/\/localhost:3210\/beebox\/docs\/reference\/cards\/index\.md\): Every card type\./);
  assert.match(out, /- \[llms\.txt]\(http:\/\/localhost:3210\/beebox\/llms\.txt\): the evaluator-facing index[^\n]*\n?$/);
});

test("renderEntryLlmsTxt: start-here orders its files first, the rest fall to Files", () => {
  const out = renderEntryLlmsTxt({
    base: "/beebox/",
    title: "Bee Box for contributors",
    dirName: "dev",
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
    "- [contributing.md](http://localhost:3210/beebox/docs/dev/contributing.md): How a change lands.\n" +
      "- [testing.md](http://localhost:3210/beebox/docs/dev/testing.md): How tests work.",
  );
  const filesSection = out.split("## Files\n\n")[1]?.split("\n\n## Also")[0];
  assert.equal(filesSection, "- [architecture.md](http://localhost:3210/beebox/docs/dev/architecture.md): How it's built.");
});

test("renderEntryLlmsTxt: a start-here filename not published under its directory fails", () => {
  assert.throws(
    () =>
      renderEntryLlmsTxt({
        base: "/beebox/",
        title: "Bee Box for contributors",
        dirName: "dev",
        readme: { summary: "s", preamble: "p" },
        startHere: ["missing.md"],
        files: [doc({ publishPath: "dev/contributing.md", description: "x" })],
        also: ALSO,
      }),
    DocsIndexError,
  );
});

test("renderEntryLlmsTxt: install/ works the same shape with an empty Also", () => {
  const out = renderEntryLlmsTxt({
    base: "/beebox/",
    title: "Bee Box install",
    dirName: "install",
    readme: { summary: "How to get a box running.", preamble: "" },
    startHere: undefined,
    files: [doc({ publishPath: "install/docker.md", description: "Docker install." })],
    also: [],
  });
  assert.match(out, /^# Bee Box install\n/);
  assert.match(out, /- \[docker\.md]\(http:\/\/localhost:3210\/beebox\/docs\/install\/docker\.md\): Docker install\./);
  assert.match(out, /## Also\n\n- \[llms\.txt]/);
});
