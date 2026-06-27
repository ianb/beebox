# validate-markdown: staged markdown + lintable predicate

`cb validate --staged` lints staged markdown the way it lints staged cards.
`listStagedMarkdown` collects the staged `.md` files worth linting, and
`isLintableMarkdown` is the shared skip predicate (`--all` and `--staged` agree).

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  listStagedMarkdown,
  lintMarkdownFiles,
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
await mkdir(join(box.root, "store/images"), { recursive: true });
await writeFile(join(box.root, "store/images/a.webp"), "x");

const doc = join(box.root, "store/docs/saoirse.md");
await mkdir(dirname(doc), { recursive: true });
await writeFile(doc, "![ok](/store/images/a.webp)\n![broken](/store/images/missing.webp)\n");
execSync("git add -A", { cwd: box.root });

const staged = await listStagedMarkdown(box.root);
staged.map((p) => relative(box.root, p))
=>
[
  "store/docs/saoirse.md"
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

`isLintableMarkdown` accepts box markdown but skips `CLAUDE.md`, `.claude/` rule
docs, and non-markdown:

```ts
isLintableMarkdown("store/docs/saoirse.md")
=> true

isLintableMarkdown("CLAUDE.md")
=> false

isLintableMarkdown("store/x/.claude/rules/foo.md")
=> false

isLintableMarkdown("store/notes.txt")
=> false
```
