# `cb rm` — trash cards, with a real dry-run

The trash command moves cards (plus their `.attach/` directories) into the
box's trash. `--dry-run` reports what would move without touching anything —
this doctest pins that contract, because the flag was once advertised by the
CLI while the command silently ignored it and trashed the files anyway.

```ts setup
import { executeTrash } from "../../../src/core/commands/trash.js";
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
=> {"dryRun":true,"wouldTrash":["box/notes/Engine.doc.card"],"errors":[]}
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
