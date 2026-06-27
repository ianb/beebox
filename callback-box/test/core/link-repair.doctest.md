# link-repair: `cb relink` repairs moved-target links

`repairBoxLinks` scans the box for broken internal markdown links and locates the
target by basename. A single match is rewritten (box-root-absolute); several
matches are disambiguated by the longest shared trailing path; a genuine tie or a
missing target is reported for an agent to resolve — never guessed.

```ts setup
import { repairBoxLinks } from "../../src/core/link-repair.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function write(box, rel, content) {
  const abs = join(box.root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}
```

A dossier links to the pre-move path of an image that now lives one directory
deeper. The basename is unique, so the link is rewritten to the real location:

```ts
const box = await makeTmpBox();
await write(box, "store/notebook/ashfield/valley/images/bram-face.attach/bram-face.webp", "IMG");
await write(box, "store/notebook/ashfield/valley/dossiers/bram.md", "# Bram\n\n![face](/store/notebook/valley/images/bram-face.attach/bram-face.webp)\n");

const report = await repairBoxLinks(box.root, { dryRun: false });
report.fixed.map((r) => `${r.oldUrl} -> ${r.newUrl}`)
=>
[
  "/store/notebook/valley/images/bram-face.attach/bram-face.webp -> /store/notebook/ashfield/valley/images/bram-face.attach/bram-face.webp"
]
```

The file on disk now points at the real image:

```ts continue
(await readFile(join(box.root, "store/notebook/ashfield/valley/dossiers/bram.md"), "utf-8")).includes("/store/notebook/ashfield/valley/images/bram-face.attach/bram-face.webp")
=> true
```

```ts continue
await box.cleanup();
```

When two files share the basename, the trailing-path overlap picks the right one
(here the `valley/` copy beats the `island/` copy):

```ts
const box = await makeTmpBox();
await write(box, "store/notebook/ashfield/valley/images/face.webp", "V");
await write(box, "store/notebook/ashfield/island/images/face.webp", "I");
await write(box, "store/notebook/ashfield/valley/dossiers/x.md", "![f](/store/notebook/valley/images/face.webp)\n");

const report = await repairBoxLinks(box.root, { dryRun: true });
[report.fixed[0]?.newUrl, report.ambiguous.length]
=>
[
  "/store/notebook/ashfield/valley/images/face.webp",
  0
]
```

```ts continue
await box.cleanup();
```

A true tie (same basename, equal trailing overlap) is reported as ambiguous —
not rewritten — with the candidates for an agent to choose:

```ts
const box = await makeTmpBox();
await write(box, "store/a/shared.webp", "A");
await write(box, "store/b/shared.webp", "B");
await write(box, "store/notes.md", "![s](/store/gone/shared.webp)\n");

const report = await repairBoxLinks(box.root, { dryRun: true });
[report.fixed.length, report.ambiguous.map((r) => r.candidates)]
=>
[
  0,
  [
    [
      "/store/a/shared.webp",
      "/store/b/shared.webp"
    ]
  ]
]
```

```ts continue
await box.cleanup();
```

A link whose basename exists nowhere is unresolvable:

```ts
const box = await makeTmpBox();
await write(box, "store/notes.md", "![x](/store/missing/ghost.webp)\n");
const report = await repairBoxLinks(box.root, { dryRun: true });
[report.fixed.length, report.ambiguous.length, report.unresolvable.map((r) => r.oldUrl)]
=>
[
  0,
  0,
  [
    "/store/missing/ghost.webp"
  ]
]
```

```ts continue
await box.cleanup();
```
