# validate-markdown: staged markdown + lintable predicate

`bbx validate --staged` lints staged markdown the way it lints staged cards.
`listStagedMarkdown` collects the staged `.md` files worth linting, and
`isLintableMarkdown` is the shared skip predicate (`--all` and `--staged` agree).

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  listStagedMarkdown,
  lintMarkdownFiles,
  boxWideLinkWarnings,
  isLintableMarkdown,
} from "../../../src/cli/commands/validate-markdown.js";
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
```

A staged dossier with a valid and a broken box-root link is collected, and
linting it surfaces the one broken link:

```ts
const box = await makeTmpBox({ git: true });
await mkdir(join(box.root, "_content/images"), { recursive: true });
await writeFile(join(box.root, "_content/images/a.webp"), "x");

const doc = join(box.root, "_content/docs/saoirse.md");
await mkdir(dirname(doc), { recursive: true });
await writeFile(doc, "![ok](/_content/images/a.webp)\n![broken](/_content/images/missing.webp)\n");
execSync("git add -A", { cwd: box.root });

const staged = await listStagedMarkdown(box.root);
staged.map((p) => relative(box.root, p))
=>
[
  "_content/docs/saoirse.md"
]
```

```ts continue
const summary = await lintMarkdownFiles(staged, { boxRoot: box.root });
summary.totalErrors
=> 1
```

```ts continue
await box.cleanup();
```

`isLintableMarkdown` accepts box markdown but skips harness instruction files, `.claude/` rule
docs, and non-markdown:

```ts
isLintableMarkdown("_content/docs/saoirse.md")
=> true

isLintableMarkdown("CLAUDE.md")
=> false

isLintableMarkdown("notes/AGENTS.md")
=> false

isLintableMarkdown("_content/x/.claude/rules/foo.md")
=> false

isLintableMarkdown("_content/notes.txt")
=> false
```

It also skips bbx's own machine-generated docs — a `docs/generated/` segment pair
at ANY depth, not just box root (generated trees are nested per-area, e.g.
`_content/roadtrip/docs/generated/`). A plain `docs/` dir that isn't generated is
still linted:

```ts
isLintableMarkdown("docs/generated/card-doc.md")
=> false

isLintableMarkdown("_content/roadtrip/docs/generated/card-email-outbound.md")
=> false

isLintableMarkdown("_content/handbook/docs/onboarding.md")
=> true
```

`boxWideLinkWarnings` is the warn-only commit-time scan: it finds a broken link
in any box file (even one that isn't staged — the move-collateral case) and
returns advisory text, or null when the box is link-clean.

```ts
const box3 = await makeTmpBox();
await mkdir(join(box3.root, "store"), { recursive: true });
await writeFile(join(box3.root, "_content/note.md"), "![gone](/_content/gone.png)\n");
const warn = await boxWideLinkWarnings(box3.root);
await box3.cleanup();
[warn?.includes("Broken link: /_content/gone.png"), warn?.includes("not blocking the commit")]
=>
[
  true,
  true
]
```

```ts
const box4 = await makeTmpBox();
await mkdir(join(box4.root, "_content/img"), { recursive: true });
await writeFile(join(box4.root, "_content/img/a.png"), "x");
await writeFile(join(box4.root, "_content/ok.md"), "![a](/_content/img/a.png)\n");
const clean = await boxWideLinkWarnings(box4.root);
await box4.cleanup();
clean
=> null
```

Generated docs (`docs/generated/`, regenerated and full of placeholder example
links) are skipped, so they never flood the warning:

```ts
const box5 = await makeTmpBox();
await mkdir(join(box5.root, "docs/generated"), { recursive: true });
await writeFile(join(box5.root, "docs/generated/card-x.md"), "![ex](attach/photo.jpg)\n[text](url)\n");
const genWarn = await boxWideLinkWarnings(box5.root);
await box5.cleanup();
genWarn
=> null
```

Nested per-area generated docs (`_content/<area>/docs/generated/`, the shape that
actually appeared on prod) are skipped too — the old root-anchored ignore missed
these, so their placeholder links leaked into the scan:

```ts
const box6 = await makeTmpBox();
await mkdir(join(box6.root, "_content/roadtrip/docs/generated"), { recursive: true });
await writeFile(join(box6.root, "_content/roadtrip/docs/generated/card-doc.md"), "![caffeine](/_content/figures/Molecule.figure.card)\n[Recipe](/_content/archive/Pasta.recipe.card)\n");
const nestedWarn = await boxWideLinkWarnings(box6.root);
await box6.cleanup();
nestedWarn
=> null
```

The box-specific `_config/bbx-validate.ignore` (the boxholder's gitignore-style
escape hatch) suppresses links under any path it matches. A broken link in a
vendored tree is silenced once the tree is listed, and restored when it isn't:

```ts
const box7 = await makeTmpBox();
await mkdir(join(box7.root, "vendor/imported"), { recursive: true });
await writeFile(join(box7.root, "vendor/imported/sample.md"), "![gone](/_content/nope.png)\n");

const beforeIgnore = await boxWideLinkWarnings(box7.root);
beforeIgnore?.includes("Broken link: /_content/nope.png")
=> true
```

```ts continue
await mkdir(join(box7.root, "_config"), { recursive: true });
await writeFile(join(box7.root, "_config/bbx-validate.ignore"), "vendor/**\n");
const afterIgnore = await boxWideLinkWarnings(box7.root);
await box7.cleanup();
afterIgnore
=> null
```
