# Box card and Markdown listings

`listBoxCardFiles` and `listBoxMarkdownFiles` skip a publication project's
build output (`<name>.attach/project/dist/`) and `node_modules/` at any depth.
The project's `src/` stays listed.

```ts
import * as path from "node:path";
import { listBoxCardFiles, listBoxMarkdownFiles } from "../../src/core/list-cards.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const box = await makeTmpBox();
const project = "_content/trips/Site.attach/project";
await box.write(`${project}/dist/page.md`, "# Built\n");
await box.write(`${project}/dist/stray.note.card`, "---\n---\n");
await box.write(`${project}/node_modules/pkg/README.md`, "# pkg\n");
await box.write(`${project}/src/readme.md`, "# Source\n");
const underProject = (files: string[]): string[] =>
  files.map((abs) => path.relative(box.root, abs)).filter((rel) => rel.startsWith(project));

underProject(await listBoxMarkdownFiles(box.root))
=> [ "_content/trips/Site.attach/project/src/readme.md" ]

underProject(await listBoxCardFiles(box.root))
=> []

await box.cleanup();
```
