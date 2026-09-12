import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DocsManifestError, loadManifestEntries } from "./docs-manifest.js";

function writeManifest(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-manifest-"));
  const file = path.join(dir, "docs-manifest.yaml");
  fs.writeFileSync(file, text);
  return file;
}

test("loadManifestEntries: a missing manifest is legal (empty starter set)", () => {
  assert.deepEqual(loadManifestEntries("/no/such/docs-manifest.yaml"), []);
});

test("loadManifestEntries: an admissible flat doc and design/architecture doc load", () => {
  const file = writeManifest(
    "- source: beebox/docs/glossary.md\n  publish: concepts/glossary.md\n  description: terms\n" +
      "- source: beebox/docs/design/identity.md\n  publish: design/identity.md\n  description: identity\n",
  );
  const entries = loadManifestEntries(file);
  assert.equal(entries.length, 2);
});

test("loadManifestEntries: a source outside the admissible prefixes fails the build", () => {
  const file = writeManifest("- source: beebox/docs/plans/foo.md\n  publish: concepts/foo.md\n  description: x\n");
  assert.throws(() => loadManifestEntries(file), DocsManifestError);
});

test("loadManifestEntries: a nested beebox/docs/ subdirectory (not design/architecture) is refused", () => {
  const file = writeManifest("- source: beebox/docs/box/foo.md\n  publish: concepts/foo.md\n  description: x\n");
  assert.throws(() => loadManifestEntries(file), DocsManifestError);
});

test("loadManifestEntries: root README.md is admissible as a source", () => {
  const file = writeManifest("- source: README.md\n  publish: concepts/readme.md\n  description: x\n");
  assert.equal(loadManifestEntries(file).length, 1);
});

test("loadManifestEntries: a publish path outside the admissible directories fails the build", () => {
  const file = writeManifest("- source: beebox/docs/glossary.md\n  publish: reference/glossary.md\n  description: x\n");
  assert.throws(() => loadManifestEntries(file), DocsManifestError);
});

test("loadManifestEntries: malformed manifest (missing required field) fails the build", () => {
  const file = writeManifest("- source: beebox/docs/glossary.md\n  publish: concepts/glossary.md\n");
  assert.throws(() => loadManifestEntries(file), DocsManifestError);
});

test("loadManifestEntries: traversal in a source or publish path is refused before the prefix check", () => {
  const source = writeManifest("- source: beebox/docs/design/../../../issues/features/x.md\n  publish: design/x.md\n  description: x\n");
  assert.throws(() => loadManifestEntries(source), DocsManifestError);
  const publish = writeManifest("- source: beebox/docs/glossary.md\n  publish: contracts/../../llms.txt\n  description: x\n");
  assert.throws(() => loadManifestEntries(publish), DocsManifestError);
});
