import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DocsAuthoredError, loadAuthoredDocs } from "./docs-authored.js";
import { FrontmatterError } from "./render.js";

async function tmpDocsDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-authored-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}

test("loadAuthoredDocs: a spine file, an index stub, and README load", async () => {
  const dir = await tmpDocsDir({
    "01-what-bee-box-is.md": '---\ndescription: "What it is."\n---\n# What Bee Box is\n\nBody.\n',
    "concepts/index.md": '---\ndescription: "Core vocabulary."\n---\n',
    "README.md": '---\ndescription: "One line."\n---\nPreamble body.\n',
  });
  const corpus = await loadAuthoredDocs({ docsDir: dir, repoRoot: dir });
  assert.equal(corpus.docs.length, 1);
  assert.equal(corpus.docs[0]?.publishPath, "01-what-bee-box-is.md");
  assert.equal(corpus.indexPurposes.get("concepts"), "Core vocabulary.");
  assert.deepEqual(corpus.readme, { summary: "One line.", preamble: "Preamble body." });
});

test("loadAuthoredDocs: a compared/ page without compared: frontmatter fails", async () => {
  const dir = await tmpDocsDir({ "compared/foo.md": '---\ndescription: "x"\n---\nbody\n' });
  await assert.rejects(loadAuthoredDocs({ docsDir: dir, repoRoot: dir }), DocsAuthoredError);
});

test("loadAuthoredDocs: compared: frontmatter outside compared/ fails", async () => {
  const dir = await tmpDocsDir({
    "concepts/foo.md":
      '---\ndescription: "x"\ncompared:\n  date: "2026-01-01"\n  subject: "s"\n  beebox: "b"\n  looked-for: ["a"]\n  not-looked-for: []\n---\nbody\n',
  });
  await assert.rejects(loadAuthoredDocs({ docsDir: dir, repoRoot: dir }), DocsAuthoredError);
});

test("loadAuthoredDocs: a non-spine file directly under docs/ fails", async () => {
  const dir = await tmpDocsDir({ "notes.md": '---\ndescription: "x"\n---\nbody\n' });
  await assert.rejects(loadAuthoredDocs({ docsDir: dir, repoRoot: dir }), DocsAuthoredError);
});

test("loadAuthoredDocs: missing frontmatter fails naming file and line", async () => {
  const dir = await tmpDocsDir({ "capabilities/gmail.md": "no frontmatter here\n" });
  await assert.rejects(loadAuthoredDocs({ docsDir: dir, repoRoot: dir }), FrontmatterError);
});

test("loadAuthoredDocs: a directory README.md is a preamble, keyed by directory, never published", async () => {
  const dir = await tmpDocsDir({
    "01-what-bee-box-is.md": '---\ndescription: "What it is."\n---\n# What Bee Box is\n\nBody.\n',
    "README.md": '---\ndescription: "One line."\n---\nRoot preamble.\n',
    "dev/index.md": '---\ndescription: "Dev process."\n---\n',
    "dev/README.md": '---\ndescription: "For contributors."\nstart-here: [contributing.md]\n---\nDev preamble.\n',
    "dev/contributing.md": '---\ndescription: "How a change lands."\n---\nbody\n',
  });
  const corpus = await loadAuthoredDocs({ docsDir: dir, repoRoot: dir });
  assert.equal(corpus.docs.length, 2);
  assert.ok(!corpus.docs.some((d) => d.publishPath.endsWith("README.md")));
  assert.deepEqual(corpus.dirReadmes.get("dev"), {
    summary: "For contributors.",
    preamble: "Dev preamble.",
    startHere: ["contributing.md"],
  });
});

test("loadAuthoredDocs: a directory README.md without start-here has it undefined", async () => {
  const dir = await tmpDocsDir({
    "concepts/index.md": '---\ndescription: "Core vocabulary."\n---\n',
    "concepts/README.md": '---\ndescription: "Concepts."\n---\nPreamble.\n',
  });
  const corpus = await loadAuthoredDocs({ docsDir: dir, repoRoot: dir });
  assert.equal(corpus.dirReadmes.get("concepts")?.startHere, undefined);
});

test("loadAuthoredDocs: an empty docs/ directory (not yet created) is legal", async () => {
  const dir = path.join(os.tmpdir(), "docs-authored-missing-does-not-exist");
  const corpus = await loadAuthoredDocs({ docsDir: dir, repoRoot: dir });
  assert.deepEqual(corpus.docs, []);
  assert.equal(corpus.readme, undefined);
});
