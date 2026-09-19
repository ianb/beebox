# Migration: retire the process-pages procedure

`scripts/migrate/retire-process-pages.ts` removes the retired `process-pages`
procedure from a box (`installProcedures` never prunes). Nothing has written
its input, `*.record.card` pages in `pages-saved/`, since the clerk's Save
Page action was removed. A copy that still reads `pages-saved` is dead
whatever else was edited, so it is deleted. A copy repointed elsewhere is
parked under `_config/_template-updates/` for review. Parked mirrors of the
old template are deleted, since upstream no longer ships it.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { retireProcessPages } from "../../../scripts/migrate/retire-process-pages.js";

const PROCEDURE_REL = "_config/procedures/process-pages.procedure.card";
const PARKED_REL = "_config/_template-updates/_config/procedures/process-pages.procedure.card";
const LEGACY_PARKED_REL = "_config/_template-updates/procedures/process-pages.procedure.card";

// The shape field boxes hold: pre-one-root paths, possibly the retired command.
const DEAD_COPY = "---\nname: process-pages\nsteps:\n  - id: intake\n    precheck:\n      shells:\n        - saved=$(ls box/inbox/pages-saved/*.record.card | wc -l)\n---\n";
const REPOINTED = "---\nname: process-pages\nsteps:\n  - id: intake\n    precheck:\n      shells:\n        - ls _content/inbox/*.webpage.card\n---\n";

async function exists(box, rel) {
  try { await box.read(rel); return true; } catch { return false; }
}
```

## A copy that still reads pages-saved is deleted, with parked mirrors

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, DEAD_COPY);
await box.write(PARKED_REL, DEAD_COPY);
await box.write(LEGACY_PARKED_REL, DEAD_COPY);
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

## A repointed copy is parked, not destroyed

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, REPOINTED);
const result = await retireProcessPages({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"procedure":"parked","removedMirrors":[],"parkedAt":"_config/_template-updates/_config/procedures/process-pages.procedure.card"}

[await exists(box, PROCEDURE_REL), (await box.read(PARKED_REL)) === REPOINTED].join(",")
=> false,true
```

```ts cleanup
await box.cleanup();
```

## Dry run writes nothing

```ts
const box = await makeTmpBox();
await box.write(PROCEDURE_REL, DEAD_COPY);
const result = await retireProcessPages({ boxRoot: box.root, apply: false });
[result.procedure, await exists(box, PROCEDURE_REL)].join(",")
=> deleted,true
```

```ts cleanup
await box.cleanup();
```
