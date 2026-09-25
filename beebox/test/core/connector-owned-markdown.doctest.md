# Connector-owned markdown is exempt from lint

A gdoc card's markdown is Google's export mirrored into the card's attach
scope, and the connector pushes whatever is on disk back upstream.
Linting it gates commits on a file nobody wrote — and invites the "fix the lint
error" edit that destroyed two Google Docs (`issues/bugs/2026-09-16-drive-doc-round-trip-destroyed-by-lint-driven-whitespace-edit.md`).

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import {
  isConnectorOwnedMarkdown,
  connectorOwnedEditWarning,
} from "../../src/core/connector-owned-markdown.js";
import { lintMarkdownFiles } from "../../src/cli/commands/validate-markdown.js";
import { join } from "node:path";
```

Google's export encodes a line break inside a nested list item as trailing
spaces, and the run of them is not always the two MD009 tolerates. Inside a
gdoc's attach scope the file is not linted at all; the identical file beside a
`doc` card — ordinary authored content — still is:

```ts
const box = await makeTmpBox({ git: true });
const exported = "- [ ] Parent   \n      - [ ] Child   \n";

await box.seed("_content/drive/Checklist.gdoc.card", "---\ndrive-id: doc-1\n---\n");
await box.seed("_content/drive/Checklist.attach/Checklist.md", exported);
await box.seed("_content/notes/Plan.doc.card", "---\ntitle: Plan\n---\n");
await box.seed("_content/notes/Plan.attach/Plan.md", exported);

const lint = async (rel: string) =>
  (await lintMarkdownFiles([join(box.root, rel)], { boxRoot: box.root })).totalErrors;

await lint("_content/drive/Checklist.attach/Checklist.md")
=> 0

await lint("_content/notes/Plan.attach/Plan.md")
=> 2
```

The exemption covers only what the connector writes and pushes: the card's own
`<basename>.md`, and the `<basename>.remote.md` a refused push parks beside it.
An agent's notes in the same attach scope are authored content and still lint.

```ts continue
await box.seed("_content/drive/Checklist.attach/Checklist.remote.md", exported);
await box.seed("_content/drive/Checklist.attach/notes.md", exported);

await lint("_content/drive/Checklist.attach/Checklist.remote.md")
=> 0

await lint("_content/drive/Checklist.attach/notes.md")
=> 2
```

It is decided by the owner card, not the directory name, so an attach scope
whose owner card is gone is ordinary content again:

```ts continue
await box.seed("_content/orphan/Gone.attach/Gone.md", exported);

await lint("_content/orphan/Gone.attach/Gone.md")
=> 2
```

```ts continue
await isConnectorOwnedMarkdown(join(box.root, "_content/drive/Checklist.attach/Checklist.md"))
=> true

await isConnectorOwnedMarkdown(join(box.root, "_content/notes/Plan.attach/Plan.md"))
=> false

await isConnectorOwnedMarkdown(join(box.root, "_content/drive/Checklist.attach/notes.md"))
=> false

await isConnectorOwnedMarkdown(join(box.root, "_content/drive/Checklist.gdoc.card"))
=> false
```

A mixed batch lints the authored file and skips the connector-owned one, so the
box-wide and staged passes stay useful:

```ts continue
const summary = await lintMarkdownFiles(
  [
    join(box.root, "_content/drive/Checklist.attach/Checklist.md"),
    join(box.root, "_content/notes/Plan.attach/Plan.md"),
  ],
  { boxRoot: box.root },
);
summary.filesChecked
=> 1

summary.totalErrors
=> 2
```

```ts continue
await box.cleanup();
```

The same predicate drives what an agent is told when it writes to one of these
files — the moment the edit is still the current thought, rather than a rule
read long beforehand:

```ts
const warning = connectorOwnedEditWarning("/box/_content/drive/Checklist.attach/Checklist.md");
warning.includes("Never edit it to satisfy a linter");
=> true

warning.includes("An empty `lossy:` on the card does NOT mean an edit is safe");
=> true
```
