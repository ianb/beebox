# Migration: retire the process-pages procedure

`scripts/migrate/retire-process-pages.ts` removes the retired `process-pages`
procedure from a box (`installProcedures` never prunes). Nothing has written
its input, `*.record.card` pages in `pages-saved/`, since the clerk's Save
Page action was removed. As in `retire-process-captures`, only a
recognizably unedited copy is deleted: one whose hash matches a shipped
version, or the hash the box's template tracker recorded at install. Any
other copy is parked under `_config/_template-updates/` for review. Parked
mirrors are deleted only when they are exact shipped bytes.

```ts setup
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { retireProcessPages, SHIPPED_PROCEDURE_HASHES } from "../../../scripts/migrate/retire-process-pages.js";
import { hashProcedureCard } from "../../../scripts/migrate/retire-process-captures.js";

const PROCEDURE_REL = "_config/procedures/process-pages.procedure.card";
const PARKED_REL = "_config/_template-updates/_config/procedures/process-pages.procedure.card";
const LEGACY_PARKED_REL = "_config/_template-updates/procedures/process-pages.procedure.card";

// The last version the template shipped, byte for byte.
const HERE = dirname(fileURLToPath(import.meta.url));
const STOCK = await readFile(join(HERE, "../../fixtures/process-pages/stock.procedure.card"), "utf-8");
// A box copy a migration rewrote: stock no longer, but the tracker recorded it.
const REWRITTEN = STOCK.replaceAll("box/inbox/", "content/box/inbox/");
// A boxholder's edit that still mentions the dead input.
const EDITED = STOCK.replace("route them", "route them (and ping me about recipes)");

async function exists(box, rel) {
  try { await box.read(rel); return true; } catch { return false; }
}
```

## The fixture is a recognized shipped version

```ts
SHIPPED_PROCEDURE_HASHES.includes(hashProcedureCard(STOCK))
=> true
```

## A stock copy is deleted, with stock parked mirrors

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, STOCK);
await box.write(PARKED_REL, STOCK);
await box.write(LEGACY_PARKED_REL, STOCK);
const result = await retireProcessPages({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"procedure":"deleted","removedMirrors":["_config/_template-updates/_config/procedures/process-pages.procedure.card","_config/_template-updates/procedures/process-pages.procedure.card"]}

[await exists(box, PROCEDURE_REL), await exists(box, PARKED_REL), await exists(box, LEGACY_PARKED_REL)].join(",")
=> false,false,false
```

A second run is a clean no-op:

```ts continue
JSON.stringify(await retireProcessPages({ boxRoot: box.root, apply: true }))
=> {"procedure":"absent","removedMirrors":[]}
```

```ts cleanup
await box.cleanup();
```

## A copy the tracker recorded is stock for this box

The tracker may still key the card by its pre-one-root path.

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, REWRITTEN);
await box.write("_config/template-versions.json", JSON.stringify({
  "config/procedures/process-pages.procedure.card": { sha256: hashProcedureCard(REWRITTEN), "installed-at": "t" },
}));
(await retireProcessPages({ boxRoot: box.root, apply: true })).procedure
=> deleted
```

```ts cleanup
await box.cleanup();
```

## An edited copy is parked, and a rerun keeps it

The edit still mentions `pages-saved`, so a content test would have deleted
it. A second run must not remove the parked copy: it is not shipped bytes.

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, EDITED);
const result = await retireProcessPages({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"procedure":"parked","removedMirrors":[],"parkedAt":"_config/_template-updates/_config/procedures/process-pages.procedure.card"}

[await exists(box, PROCEDURE_REL), (await box.read(PARKED_REL)) === EDITED].join(",")
=> false,true
```

```ts continue
JSON.stringify(await retireProcessPages({ boxRoot: box.root, apply: true }))
=> {"procedure":"absent","removedMirrors":[]}

(await box.read(PARKED_REL)) === EDITED
=> true
```

```ts cleanup
await box.cleanup();
```

## Dry run writes nothing

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, STOCK);
const result = await retireProcessPages({ boxRoot: box.root, apply: false });
[result.procedure, await exists(box, PROCEDURE_REL)].join(",")
=> deleted,true
```

```ts cleanup
await box.cleanup();
```
