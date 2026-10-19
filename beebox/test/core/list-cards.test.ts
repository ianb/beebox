// # Box card and Markdown listings

import { test } from "tap";
import "@ianbicking/tap-check/tap";

// `listBoxCardFiles` and `listBoxMarkdownFiles` skip a publication project's
// build output (`<name>.attach/project/dist/`) and `node_modules/` at any depth.
// The project's `src/` stays listed.
void test("listBoxCardFiles and listBoxMarkdownFiles skip a publication project's build...", async (t) => {
  // doctest:L8
  const path = await import("node:path");
  const { listBoxCardFiles, listBoxMarkdownFiles } = await import("../../src/core/list-cards.js");
  const { makeTmpBox } = await import("../helpers/test-helpers.js");

  // doctest:L12
  const box = await makeTmpBox();
  const project = "_content/trips/Site.attach/project";
  await box.write(`${project}/dist/page.md`, "# Built\n");
  await box.write(`${project}/dist/stray.note.card`, "---\n---\n");
  await box.write(`${project}/node_modules/pkg/README.md`, "# pkg\n");
  await box.write(`${project}/src/readme.md`, "# Source\n");
  const underProject = (files: string[]): string[] =>
    files.map((abs) => path.relative(box.root, abs)).filter((rel) => rel.startsWith(project));

  // doctest:L21
  t.check(underProject(await listBoxMarkdownFiles(box.root)), [
    "_content/trips/Site.attach/project/src/readme.md",
  ]);

  // doctest:L24
  t.check(underProject(await listBoxCardFiles(box.root)), []);

  // doctest:L27
  await box.cleanup();
});
