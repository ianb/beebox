# Knowledge-audit box resolution

`knowledge-audit run --box <path>` may be handed either a v2 package root or its
nested operational (`content/`) root. `resolveAuditBox` normalizes both to the
operational root (so doc-regen and test runs hit the box, not the package
wrapper — the ENOENT-on-`.beebox/box.json` crash this fixes) and derives a stable ledger
identity from the package-root basename.

```ts setup
import * as path from "node:path";
import { resolveAuditBox } from "../../../src/dev/lib/audit-box.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

`makeTmpBox` builds a real shape-2 box: `box.root` is the operational
(`content/`) root, `box.packageRoot` its parent package.

Passing the **package root** resolves to the operational root, and names the box
after the package (not the useless "content"):

```ts
const box = await makeTmpBox();
const fromPackage = await resolveAuditBox(box.packageRoot);
JSON.stringify({
  operational: fromPackage.operationalRoot === box.root,
  boxName: fromPackage.boxName === path.basename(box.packageRoot),
})
=> {"operational":true,"boxName":true}
```

Passing the **operational (`content/`) root** gives the same identity — both
forms are the same box:

```ts continue
const fromContent = await resolveAuditBox(box.root);
JSON.stringify({
  sameRoot: fromContent.operationalRoot === fromPackage.operationalRoot,
  sameName: fromContent.boxName === fromPackage.boxName,
})
=> {"sameRoot":true,"sameName":true}
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
