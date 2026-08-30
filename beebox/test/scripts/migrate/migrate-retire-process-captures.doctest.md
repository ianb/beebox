# Migration: retire the process-captures pipeline

`scripts/migrate/retire-process-captures.ts` prunes the retired
`process-captures` procedure card and its one-shot scheduled trigger from a
deployed box (`installProcedures` never prunes). A **stock** procedure card —
one whose content hash matches a shipped version in `SHIPPED_PROCEDURE_HASHES`
— is deleted outright; a **boxholder-modified** copy is parked to
`config/_template-updates/` for review instead of being destroyed. Missing
files are a clean no-op. `retireProcessCaptures({ boxRoot, apply })` is the
testable core (no argv/exit).

```ts setup
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  retireProcessCaptures,
  hashProcedureCard,
  SHIPPED_PROCEDURE_HASHES,
} from "../../../scripts/migrate/retire-process-captures.js";

const PROCEDURE_REL = "config/procedures/process-captures.procedure.card";
const TRIGGER_REL = "config/schedules/process-captures.scheduled-script.card";
const PARKED_REL = "config/_template-updates/config/procedures/process-captures.procedure.card";

// The exact stock content one shipped version of the procedure card had,
// captured as a fixture. Its hash must be an enumerated shipped hash — the
// migration only deletes what it recognizes.
const HERE = dirname(fileURLToPath(import.meta.url));
const STOCK = await readFile(join(HERE, "../../fixtures/process-captures/stock.procedure.card"), "utf-8");

async function exists(box, rel) {
  try { await box.read(rel); return true; } catch { return false; }
}
```

## The fixture is a recognized shipped version

```ts
SHIPPED_PROCEDURE_HASHES.includes(hashProcedureCard(STOCK))
=> true
```

## Stock procedure card + trigger → both removed

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, STOCK);
await box.write(TRIGGER_REL, "onWakeup: true\nonce: true\nruns: bbx procedure run process-captures\n");
const result = await retireProcessCaptures({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"procedure":"deleted","trigger":"deleted"}

[await exists(box, PROCEDURE_REL), await exists(box, TRIGGER_REL)].join(",")
=> false,false
```

## Dry run reports the action but writes nothing

```ts continue
await box.write(PROCEDURE_REL, STOCK);
const dry = await retireProcessCaptures({ boxRoot: box.root, apply: false });
JSON.stringify(dry)
=> {"procedure":"deleted","trigger":"absent"}

await exists(box, PROCEDURE_REL)
=> true
```

```ts cleanup
await box.cleanup();
```

## A boxholder-modified card is parked, not deleted

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, STOCK + "\n# boxholder's local tweak\n");
const result = await retireProcessCaptures({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"procedure":"parked","trigger":"absent","parkedAt":"config/_template-updates/config/procedures/process-captures.procedure.card"}

// Removed from the active procedures dir, preserved under _template-updates/.
[await exists(box, PROCEDURE_REL), await exists(box, PARKED_REL)].join(",")
=> false,true

// The parked copy keeps the boxholder's edit verbatim.
(await box.read(PARKED_REL)).endsWith("# boxholder's local tweak\n")
=> true
```

```ts cleanup
await box.cleanup();
```

## Missing files → clean no-op (idempotent re-run)

```ts
const box = await makeTmpBox();
const result = await retireProcessCaptures({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"procedure":"absent","trigger":"absent"}
```

```ts cleanup
await box.cleanup();
```
