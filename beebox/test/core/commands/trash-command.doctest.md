# `bbx rm` — trash cards, with a real dry-run

The trash command moves cards (plus their `.attach/` directories) into the
box's trash. `--dry-run` reports what would move without touching anything —
this doctest pins that contract, because the flag was once advertised by the
CLI while the command silently ignored it and trashed the files anyway.

```ts setup
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
  "box/notes/Engine.doc.card",
  "---\ntype: doc\ntitle: Engine\n---\nBody.\n",
);

const dry = await rm(box, { paths: ["box/notes/Engine.doc.card"], dryRun: true });
JSON.stringify(dry.data)
=> {"dryRun":true,"wouldTrash":["box/notes/Engine.doc.card"],"errors":[],"inboundRefs":{"box/notes/Engine.doc.card":[]}}
```

The card is still in place:

```ts continue
await box.list("box/notes")
=> box/notes/Engine.doc.card
```

A dry run against a missing card fails without creating anything:

```ts continue
const missing = await rm(box, { paths: ["box/notes/Nope.doc.card"], dryRun: true });
missing.success
=> false

missing.error
=> Card not found: box/notes/Nope.doc.card
```

## Real run: the card moves to trash

```ts continue
const real = await rm(box, { paths: ["box/notes/Engine.doc.card"] });
real.success
=> true

await box.list("store/trash")
=> store/trash/Engine.doc.card

await box.list("box/notes")
=>
```

## Inbound refs are resolved from each referring document

The report comes from the same scanner as `bbx mv`, so relative refs and refs
into the card's attach scope are included without changing the referrers.

```ts
const linked = await makeTmpBox();
await linked.write("box/notes/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\n");
await linked.write("box/notes/Source.doc.card", "---\ntype: doc\nrefs:\n  - Target.doc.card\n---\n[attachment](Target.attach/photo.png)\n");
await linked.write("box/Index.md", "[target](notes/Target.doc.card)\n");
await linked.write("store/trash/Old.doc.card", "---\ntype: doc\n---\n[old](../../box/notes/Target.doc.card)\n");
await linked.write("box/Fenced.md", "```md\n[example](notes/Target.doc.card)\n```\n");

const report = await rm(linked, { paths: ["box/notes/Target.doc.card"], dryRun: true });
JSON.stringify(report.data.inboundRefs)
=> {"box/notes/Target.doc.card":[{"path":"box/Index.md","refs":1},{"path":"box/notes/Source.doc.card","refs":2}]}

await linked.read("box/notes/Source.doc.card")
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
await rollback.write("box/inbox/Rollback.doc.card", "---\ntype: doc\n---\n");
await rollback.write("box/inbox/Rollback.attach/file.txt", "attached");
await rollback.commitAll("seed rollback card");
const { ctx: rollbackCtx } = createCollectorContext(rollback.root);
const receipt = await moveCardsToTrash(rollbackCtx, ["box/inbox/Rollback.doc.card"]);
await rollbackTrashReceipt(rollback.root, receipt);
JSON.stringify({ inbox: await rollback.list("box/inbox"), trash: await rollback.list("store/trash") })
=> {"inbox":"box/inbox/Rollback.attach\nbox/inbox/Rollback.attach/file.txt\nbox/inbox/Rollback.doc.card","trash":""}
```
