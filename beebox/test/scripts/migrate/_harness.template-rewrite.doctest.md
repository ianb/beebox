# Migrations keep stock template tracking in step

The migration harness records a rewrite of an unmodified managed template. A later upstream install can then update it without mistaking the migration for a box edit.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runMigration } from "../../../src/scripts/migrate/_harness.js";
import { installTemplateFile } from "../../../src/core/install-template-file.js";
```

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-migration-tracker-"));
const rel = "_content/Box.landmark.card";
await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: "---\nname: old\n---\n" });
const argv = process.argv;
const log = console.log;
try {
  process.argv = ["node", "migration", root, "--apply"];
  console.log = () => {};
  await runMigration({
    description: "rename stock field",
    match: (name) => name === "Box.landmark.card",
    convert: async (file) => {
      await fs.writeFile(file, "---\nname: migrated\n---\n");
      return "converted";
    },
  });
} finally {
  process.argv = argv;
  console.log = log;
}
(await installTemplateFile({ boxRoot: root, relPath: rel, templateContent: "---\nname: upstream\n---\n" })).outcome
=> overwritten

await fs.rm(root, { recursive: true, force: true });
```
