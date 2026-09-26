# Every tracked guide reaches every box

Plan: `docs/plans/doc-structure-box-guidance.md`, Track 1. The tricks and
publications guides used to install only from `bbx engine init`, so a box
created before a guide existed never received it. Both installers now run on
the `generateDocs` sync path beside the schemas, views, and feedback guides,
and the publications guide is a template-managed path so the sync commit
sweeps it.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { installPublicationsGuidance, installTricksFiles } from "../../src/core/box/templates.js";
import { isTemplateManagedPath } from "../../src/core/install-template-file.js";
import { installValidationHooks } from "../../src/core/install-validation-hooks.js";

const exists = async (root: string, rel: string): Promise<boolean> => {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch (_e) {
    return false;
  }
};
```

## A box without the guides gains them from the sync installers

The scaffold installs both guides today, so an old box is simulated by
removing them and their tracker entries. Running the two installers (the calls
`syncTemplatesFromSource` now makes) writes both back through the template
tracker, so each is recorded in `_config/template-versions.json` and takes
future stock updates instead of parking.

```ts
const box = await makeTmpBox({ git: "none" });
const versionsPath = path.join(box.root, "_config/template-versions.json");
for (const rel of ["src/tricks/scripts/CLAUDE.md", "src/publications/CLAUDE.md"]) {
  await fs.rm(path.join(box.root, rel));
}
const seeded = JSON.parse(await fs.readFile(versionsPath, "utf8"));
delete seeded["src/tricks/scripts/CLAUDE.md"];
delete seeded["src/publications/CLAUDE.md"];
await fs.writeFile(versionsPath, JSON.stringify(seeded, null, 2) + "\n");

await exists(box.root, "src/tricks/scripts/CLAUDE.md")
=> false

await exists(box.root, "src/publications/CLAUDE.md")
=> false

await installTricksFiles(box.root);
await installPublicationsGuidance(box.root);

await exists(box.root, "src/tricks/scripts/CLAUDE.md")
=> true

await exists(box.root, "src/publications/CLAUDE.md")
=> true

const versions = JSON.parse(await fs.readFile(versionsPath, "utf8"));
["src/publications/CLAUDE.md", "src/tricks/scripts/CLAUDE.md"].every((k) => typeof versions[k]?.sha256 === "string")
=> true
```

Both guides are template-managed paths, so the sync commit picks them up:

```ts continue
isTemplateManagedPath("src/publications/CLAUDE.md")
=> true

isTemplateManagedPath("src/tricks/scripts/CLAUDE.md")
=> true
```

## The retired `cb-validate-ignore.md` rule is pruned

`generateRules` prunes only `card-*` and `connector-*` files, so a box that
predates the CLI rename carried both spellings of the validate-ignore
rule. The rule's own installer removes the retired one.

```ts continue
await fs.mkdir(path.join(box.root, ".claude/rules"), { recursive: true });
await fs.writeFile(path.join(box.root, ".claude/rules/cb-validate-ignore.md"), "retired\n");
await fs.writeFile(path.join(box.root, ".claude/rules/hand-written.md"), "a boxholder's own rule\n");

const changed = await installValidationHooks(box.root);
changed.includes(".claude/rules/cb-validate-ignore.md")
=> true

await exists(box.root, ".claude/rules/cb-validate-ignore.md")
=> false

await exists(box.root, ".claude/rules/bbx-validate-ignore.md")
=> true

await exists(box.root, ".claude/rules/hand-written.md")
=> true
```

```ts cleanup
await box.cleanup();
```
