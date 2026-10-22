// # `bbx ls --format`
//
// `bbx ls` lists card files. With `--format`, each `{field}` placeholder in the
// template is replaced by the scalar value at that dotted path in the card's YAML
// frontmatter (e.g. `{title}`, `{exif.camera}`). Missing or non-scalar fields
// render as the empty string. Each formatted line is `<relative-path>\t<rendered>`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { executeCommandStreaming } from "../../../src/webapp/routes/commands.js";

async function lsLines(boxRoot: string, args: Record<string, unknown>) {
  const out: (string | undefined)[] = [];
  await executeCommandStreaming({
    command: "ls",
    args,
    boxRoot,
    emit: (line) => { if (line.type === "output") out.push(line.text); },
  });
  return out;
}

// ## Format pulls scalar frontmatter fields
void test("Format pulls scalar frontmatter fields", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_content/inbox"), { recursive: true });
  await writeFile(join(box.root, "_content/inbox/Hello.doc.card"), `---
title: Hello World
prominence: primary
---
Body.
`);
  const lines = await lsLines(box.root, { paths: ["_content/inbox"], format: "{title} ({prominence})" });
  t.check(lines, [
    "_content/inbox/Hello.doc.card\tHello World (primary)",
  ]);
});

// ## Nested fields resolve; missing fields are empty
void test("Nested fields resolve; missing fields are empty", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_content/inbox"), { recursive: true });
  await writeFile(join(box.root, "_content/inbox/Photo.image.card"), `---
title: Beach
exif:
  camera: Canon
---
`);
  const nested = await lsLines(box.root, { paths: ["_content/inbox/Photo.image.card"], format: "{exif.camera}" });
  t.check(nested, [
    "_content/inbox/Photo.image.card\tCanon",
  ]);

  const missing = await lsLines(box.root, { paths: ["_content/inbox/Photo.image.card"], format: "{nope}" });
  t.check(missing, [
    "_content/inbox/Photo.image.card\t",
  ]);
});

// ## Bare `ls` (no format) lists paths only
void test("Bare `ls` (no format) lists paths only", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_content/inbox"), { recursive: true });
  await writeFile(join(box.root, "_content/inbox/Hello.doc.card"), "---\ntitle: Hi\n---\n");
  const lines = await lsLines(box.root, { paths: ["_content/inbox"] });
  t.check(lines, [
    "_content/inbox/Hello.doc.card",
  ]);
});
