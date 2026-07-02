# markdown-link-rules: CB001 no-legacy-view-links + CB002 no-broken-internal-links

```ts setup
import { lint as markdownlint } from "markdownlint/promise";
import { noBrokenInternalLinks, noLegacyViewLinks } from "../../src/core/markdown-lint-rules.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
```

## CB001 no-legacy-view-links

The `view:` URL scheme is retired: cards/files are referenced by a plain box
path. CB001 flags any surviving `view:` — in a link URL, an image (embed) URL, or
the old `[view:path]` reference-label mistake — and names the fix. Plain paths are
NOT flagged.

```ts setup
async function lintView(file: string): Promise<string[]> {
  const results = await markdownlint({
    files: [file],
    config: { default: false, "no-legacy-view-links": true },
    customRules: [noLegacyViewLinks],
  });
  return (results[file] ?? []).map((e) => `${e.ruleNames[0]}: ${e.errorDetail}`);
}
```

```ts
const vbox = await makeTmpBox();
const vdoc = join(vbox.root, "doc.md");
await writeFile(
  vdoc,
  [
    "A link [the plan](view:store/notes/Plan.doc.card) and embed ![fig](view:store/figures/F.figure.card?size=300).",
    "Old label form [view:store/x.card].",
    "Fine: [plan](store/notes/Plan.doc.card) and ![fig](/store/figures/F.figure.card).",
    "",
  ].join("\n"),
);

JSON.stringify(await lintView(vdoc), null, 2)
=>
[
  "CB001: Drop the `view:` prefix — reference the plain box path instead of ](view:store/notes/Plan.doc.card)",
  "CB001: Drop the `view:` prefix — reference the plain box path instead of ](view:store/figures/F.figure.card?size=300)",
  "CB001: Drop the `view:` prefix — reference the plain box path instead of [view:store/x.card]"
]
```

```ts continue
await vbox.cleanup();
```

## CB002 no-broken-internal-links

`noBrokenInternalLinks` (CB002) checks that internal markdown links point to a
file or directory that exists **inside the box**. It is box-root-aware: a
leading-`/` link resolves against the box root (not the OS filesystem root), and
a link that escapes the box is flagged even if the target happens to exist.

```ts setup

// Lint one markdown file with only CB002 enabled and the given boxRoot, and
// return each finding as "rule: detail" for compact assertions.
async function lintLinks(boxRoot: string, file: string): Promise<string[]> {
  const results = await markdownlint({
    files: [file],
    config: { default: false, "no-broken-internal-links": { boxRoot } },
    customRules: [noBrokenInternalLinks],
  });
  return (results[file] ?? []).map((e) => `${e.ruleNames[0]}: ${e.errorDetail}`);
}
```

A box with one real target file (`store/images/a.webp`) and a dossier that mixes
valid and broken links. Valid box-root-absolute and relative links are NOT
flagged; broken ones are; a `..`-escape out of the box is flagged even though
`/etc/hosts` exists:

```ts
const box = await makeTmpBox();
await mkdir(join(box.root, "store/images"), { recursive: true });
await writeFile(join(box.root, "store/images/a.webp"), "x");

const doc = join(box.root, "store/docs/saoirse.md");
await mkdir(dirname(doc), { recursive: true });
await writeFile(
  doc,
  [
    "![ok abs](/store/images/a.webp)",
    "![broken abs](/store/images/missing.webp)",
    "![ok rel](../images/a.webp)",
    "![broken rel](./nope.webp)",
    "![escape](../../../../../../../../etc/hosts)",
    "",
  ].join("\n"),
);

JSON.stringify(await lintLinks(box.root, doc), null, 2)
=>
[
  "CB002: Broken link: /store/images/missing.webp",
  "CB002: Broken link: ./nope.webp",
  "CB002: Link points outside the box: ../../../../../../../../etc/hosts"
]
```

```ts continue
await box.cleanup();
```

boxRoot is required: enabling the rule without it (e.g. `true`) is a caller error
and throws rather than silently mis-resolving every box-root link:

```ts
const box2 = await makeTmpBox();
const doc2 = join(box2.root, "x.md");
await writeFile(doc2, "![broken](/store/nope.webp)\n");

let thrown = "none";
try {
  await markdownlint({
    files: [doc2],
    config: { default: false, "no-broken-internal-links": true },
    customRules: [noBrokenInternalLinks],
  });
} catch (e) {
  thrown = (e as Error).name;
}
await box2.cleanup();
thrown
=> MissingBoxRootError
```
