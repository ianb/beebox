// # link-repair: `bbx relink` repairs moved-target links
//
// `repairBoxLinks` scans the box for broken internal markdown links and locates the
// target by basename. A single match is rewritten (box-root-absolute); several
// matches are disambiguated by the longest shared trailing path; a genuine tie or a
// missing target is reported for an agent to resolve — never guessed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { repairBoxLinks } from "../../src/core/link-repair.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function write({ box, rel, content }: { box: TmpBox; rel: string; content: string }) {
  const abs = join(box.root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

// A dossier links to the pre-move path of an image that now lives one directory
// deeper. The basename is unique, so the link is rewritten to the real location:
void test("A dossier links to the pre-move path of an image that now lives one directory...", async (t) => {
  const box = await makeTmpBox();
  await write({ box, rel: "store/notebook/ashfield/valley/images/bram-face.attach/bram-face.webp", content: "IMG" });
  await write({ box, rel: "store/notebook/ashfield/valley/dossiers/bram.md", content: "# Bram\n\n![face](/store/notebook/valley/images/bram-face.attach/bram-face.webp)\n" });

  const report = await repairBoxLinks(box.root, { dryRun: false });
  t.check(report, {
    fixed: [
      {
        file: "store/notebook/ashfield/valley/dossiers/bram.md",
        lineNumber: 3,
        oldUrl: "/store/notebook/valley/images/bram-face.attach/bram-face.webp",
        status: "fixed",
        newUrl: "/store/notebook/ashfield/valley/images/bram-face.attach/bram-face.webp",
        candidates: [],
      },
    ],
    ambiguous: [],
    unresolvable: [],
  });

  // The file on disk now points at the real image:

  await t.checkText(await readFile(join(box.root, "store/notebook/ashfield/valley/dossiers/bram.md"), "utf-8"), `# Bram
«blankline»
![face](/store/notebook/ashfield/valley/images/bram-face.attach/bram-face.webp)`);

  await box.cleanup();
});

// When two files share the basename, the trailing-path overlap picks the right one
// (here the `valley/` copy beats the `island/` copy):
void test("When two files share the basename, the trailing-path overlap picks the right...", async (t) => {
  const box = await makeTmpBox();
  await write({ box, rel: "store/notebook/ashfield/valley/images/face.webp", content: "V" });
  await write({ box, rel: "store/notebook/ashfield/island/images/face.webp", content: "I" });
  await write({ box, rel: "store/notebook/ashfield/valley/dossiers/x.md", content: "![f](/store/notebook/valley/images/face.webp)\n" });

  const report = await repairBoxLinks(box.root, { dryRun: true });
  t.check(report, {
    fixed: [
      {
        file: "store/notebook/ashfield/valley/dossiers/x.md",
        lineNumber: 1,
        oldUrl: "/store/notebook/valley/images/face.webp",
        status: "fixed",
        newUrl: "/store/notebook/ashfield/valley/images/face.webp",
        candidates: [],
      },
    ],
    ambiguous: [],
    unresolvable: [],
  });

  await box.cleanup();
});

// A true tie (same basename, equal trailing overlap) is reported as ambiguous —
// not rewritten — with the candidates for an agent to choose:
void test("A true tie (same basename, equal trailing overlap) is reported as ambiguous —...", async (t) => {
  const box = await makeTmpBox();
  await write({ box, rel: "store/a/shared.webp", content: "A" });
  await write({ box, rel: "store/b/shared.webp", content: "B" });
  await write({ box, rel: "store/notes.md", content: "![s](/store/gone/shared.webp)\n" });

  const report = await repairBoxLinks(box.root, { dryRun: true });
  t.check(report, {
    fixed: [],
    ambiguous: [
      {
        file: "store/notes.md",
        lineNumber: 1,
        oldUrl: "/store/gone/shared.webp",
        status: "ambiguous",
        candidates: ["/store/a/shared.webp", "/store/b/shared.webp"],
      },
    ],
    unresolvable: [],
  });

  await box.cleanup();
});

// A link whose basename exists nowhere is unresolvable:
void test("A link whose basename exists nowhere is unresolvable:", async (t) => {
  const box = await makeTmpBox();
  await write({ box, rel: "store/notes.md", content: "![x](/store/missing/ghost.webp)\n" });
  const report = await repairBoxLinks(box.root, { dryRun: true });
  t.check(report, {
    fixed: [],
    ambiguous: [],
    unresolvable: [
      {
        file: "store/notes.md",
        lineNumber: 1,
        oldUrl: "/store/missing/ghost.webp",
        status: "unresolvable",
        candidates: [],
      },
    ],
  });

  await box.cleanup();
});
