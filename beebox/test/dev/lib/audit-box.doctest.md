# Knowledge-audit box resolution

`knowledge-audit run --box <path>` names a box's one root. `resolveAuditBox`
resolves it and derives a stable ledger identity from the box root's
basename.

```ts setup
import * as path from "node:path";
import { resolveAuditBox } from "../../../src/dev/lib/audit-box.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

```ts
const box = await makeTmpBox();
const resolved = await resolveAuditBox(box.root);
JSON.stringify({
  operational: resolved.operationalRoot === box.root,
  boxName: resolved.boxName === path.basename(box.root),
})
=> {"operational":true,"boxName":true}
```

```ts cleanup
await box.cleanup();
```

A path that isn't a box passes through unchanged, named by its own basename:

```ts
const plain = path.resolve("test/dev/lib");
const resolved = await resolveAuditBox(plain);
JSON.stringify({ operational: resolved.operationalRoot === plain, boxName: resolved.boxName })
=> {"operational":true,"boxName":"lib"}
```
