# `bbx rm` — trash cards, with a real dry-run

The trash command moves cards (plus their `.attach/` directories) into the
box's trash. `--dry-run` reports what would move without touching anything —
this doctest pins that contract, because the flag was once advertised by the
CLI while the command silently ignored it and trashed the files anyway.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { executeTrash, moveCardsToTrash } from "../../../src/core/commands/trash.js";
import { rollbackTrashReceipt } from "../../../src/core/commands/trash-recovery.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function rm(box, args) {
  const { ctx } = createCollectorContext(box.root);
  return executeTrash(ctx, args);
}
```

## Dry run: reports, mutates nothing

```ts
const box = await makeTmpBox();
await box.write(
  "_content/box/notes/Engine.doc.card",
  "---\ntype: doc\ntitle: Engine\n---\nBody.\n",
);

const dry = await rm(box, { paths: ["_content/box/notes/Engine.doc.card"], dryRun: true });
JSON.stringify(dry.data)
=> {"dryRun":true,"wouldTrash":["_content/box/notes/Engine.doc.card"],"errors":[],"inboundRefs":{"_content/box/notes/Engine.doc.card":[]}}
```

The card is still in place:

```ts continue
await box.list("_content/box/notes")
=> _content/box/notes/Engine.doc.card
```

A dry run against a missing card fails without creating anything:

```ts continue
const missing = await rm(box, { paths: ["_content/box/notes/Nope.doc.card"], dryRun: true });
missing.success
=> false

missing.error
=> Card not found: _content/box/notes/Nope.doc.card
```

## Real run: the card moves to trash

```ts continue
const real = await rm(box, { paths: ["_content/box/notes/Engine.doc.card"] });
real.success
=> true

await box.list("_bookkeeping/trash")
=>
_bookkeeping/trash/.gitkeep
_bookkeeping/trash/Engine.doc.card

await box.list("_content/box/notes")
=>
```

## Round-8 hardening finding 4: a symlinked trash directory refuses, nothing moves

`_bookkeeping/trash -> ../src` — a symlink pointing at the box's own source
tree — would otherwise let an ordinary trash rename land a card in `src/`
instead of the trash. `getBoxDir`/`fs.rename` alone never check this; the
destination is now resolved through the box-namespace fence's on-disk check
before any rename.

```ts continue
const escapeBox = await makeTmpBox();
await escapeBox.write("_content/box/notes/Escape.doc.card", "---\ntype: doc\ntitle: Escape\n---\nBody.\n");
await fs.rm(path.join(escapeBox.root, "_bookkeeping", "trash"), { recursive: true, force: true });
await fs.symlink("../src", path.join(escapeBox.root, "_bookkeeping", "trash"));

const escapeResult = await rm(escapeBox, { paths: ["_content/box/notes/Escape.doc.card"] });
JSON.stringify({ success: escapeResult.success, error: escapeResult.error })
=> {"success":false,"error":"Trash destination escapes the box's data namespace: _bookkeeping/trash/Escape.doc.card"}
```

The card never moved, and nothing landed in `src/`:

```ts continue
await escapeBox.list("_content/box/notes")
=> _content/box/notes/Escape.doc.card

const srcFiles = await fs.readdir(path.join(escapeBox.root, "src"));
srcFiles.includes("Escape.doc.card")
=> false
```

## Inbound refs are resolved from each referring document

The report comes from the same scanner as `bbx mv`, so relative refs and refs
into the card's attach scope are included without changing the referrers.

```ts
const linked = await makeTmpBox();
await linked.write("_content/box/notes/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\n");
await linked.write("_content/box/notes/Source.doc.card", "---\ntype: doc\nrefs:\n  - Target.doc.card\n---\n[attachment](Target.attach/photo.png)\n");
await linked.write("_content/box/Index.md", "[target](notes/Target.doc.card)\n");
await linked.write("_bookkeeping/trash/Old.doc.card", "---\ntype: doc\n---\n[old](../../_content/box/notes/Target.doc.card)\n");
await linked.write("_content/box/Fenced.md", "```md\n[example](notes/Target.doc.card)\n```\n");

const report = await rm(linked, { paths: ["_content/box/notes/Target.doc.card"], dryRun: true });
JSON.stringify(report.data.inboundRefs)
=> {"_content/box/notes/Target.doc.card":[{"path":"_content/box/Index.md","refs":1},{"path":"_content/box/notes/Source.doc.card","refs":2}]}

await linked.read("_content/box/notes/Source.doc.card")
=>
---
type: doc
refs:
  - Target.doc.card
---
[attachment](Target.attach/photo.png)
```

## A failed commit can roll the move back

The UI uses the receipt to restore both the card and its attach scope when its
git commit fails, rather than reporting total failure after a completed move.

```ts
const rollback = await makeTmpBox({ git: true });
await rollback.write("_content/inbox/Rollback.doc.card", "---\ntype: doc\n---\n");
await rollback.write("_content/inbox/Rollback.attach/file.txt", "attached");
await rollback.commitAll("seed rollback card");
const { ctx: rollbackCtx } = createCollectorContext(rollback.root);
const receipt = await moveCardsToTrash(rollbackCtx, ["_content/inbox/Rollback.doc.card"]);
await rollbackTrashReceipt(rollback.root, receipt);
JSON.stringify({ inbox: await rollback.list("_content/inbox"), trash: await rollback.list("_bookkeeping/trash") })
=> {"inbox":"_content/inbox/.gitkeep\n_content/inbox/Rollback.attach\n_content/inbox/Rollback.attach/file.txt\n_content/inbox/Rollback.doc.card\n_content/inbox/intake\n_content/inbox/intake/.gitkeep\n_content/inbox/staged\n_content/inbox/staged/.gitkeep\n_content/inbox/triaged\n_content/inbox/triaged/.gitkeep\n_content/inbox/triaged/_unsure\n_content/inbox/triaged/_unsure/.gitkeep\n_content/inbox/unhandled\n_content/inbox/unhandled/.gitkeep","trash":"_bookkeeping/trash/.gitkeep"}
```
