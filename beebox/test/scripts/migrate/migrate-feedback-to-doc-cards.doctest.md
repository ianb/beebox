# Agent feedback Markdown to doc cards

The conversion keeps the entire old observation and context while removing the
trailing spaces that made resolved files fail markdownlint.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { convertLegacyFeedback, migrateFeedbackFile } from "../../../scripts/migrate/feedback-to-doc-cards.js";
const machineHome = ["/Users", "example"].join("/");
const old = "# Agent Feedback\n\n**Box path:** " + machineHome + "/src/boxes/test1\n\n## Feedback\n\nThe flag is unclear.  \n\n## Session Context\n\nRead " + machineHome + "/src/boxes/test1/_config/box.json. \n";
```

```ts
const converted = convertLegacyFeedback("2026-05-12T12-10-36-the-flag.md", old);
converted.includes("title: The flag is unclear.")
=> true

converted.includes("The flag is unclear.  ")
=> false

converted.includes("## Session Context\n\nRead /_config/box.json.\n")
=> true

converted.includes(machineHome)
=> false

const withExternalPath = convertLegacyFeedback("2026-05-12T12-10-36-the-flag.md", old + "\nExtra path " + machineHome + "/private\n");
withExternalPath.includes("Extra path ~/private")
=> true

withExternalPath.includes("Machine home paths in this captured context were shortened")
=> true

const withSiblingPath = convertLegacyFeedback("2026-05-12T12-10-36-the-flag.md", old + "\nSibling " + machineHome + "/src/boxes/test1-old/file\n");
withSiblingPath.includes("Sibling ~/src/boxes/test1-old/file")
=> true
```

The migration converts both unresolved and resolved files and refuses to
overwrite a different card at the destination.

```ts
const box = await makeTmpBox();
const dir = path.join(box.root, "_config", "feedback");
const resolved = path.join(dir, "resolved");
await fs.mkdir(resolved, { recursive: true });
const name = "2026-05-12T12-10-36-the-flag.md";
const activeSource = path.join(dir, name);
const resolvedSource = path.join(resolved, name);
await fs.writeFile(activeSource, old);
await fs.writeFile(resolvedSource, old);

await migrateFeedbackFile(activeSource)
=> converted

await migrateFeedbackFile(resolvedSource)
=> converted

await fs.readdir(dir).then((names) => names.includes(name))
=> false

await fs.readdir(resolved).then((names) => names.includes(name.replace(/\.md$/, ".doc.card")))
=> true

await fs.writeFile(activeSource, old);
await migrateFeedbackFile(activeSource)
=> converted

await fs.writeFile(activeSource, old + "different");
await migrateFeedbackFile(activeSource)
=> throws Error
```

```ts cleanup
await box.cleanup();
```
