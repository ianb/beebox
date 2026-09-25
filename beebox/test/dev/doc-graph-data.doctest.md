# Documentation graph external-reference resolution

Monorepo documents outside the external-source scan roots are still valid link
targets. Resolving one does not require adding it to the source scan, while a
missing target or a relative path that escapes the monorepo stays unresolved.

```ts setup
import { resolveExternalRef, type ExternalResolveContext } from "../../src/dev/doc-graph-data.js";

const context: ExternalResolveContext = {
  fromFile: "CLAUDE.md",
  internalFiles: [],
  externalFiles: [],
  internalBasenames: new Map(),
  externalBasenames: new Map(),
};
```

```ts
JSON.stringify(resolveExternalRef("beebox-clerk/CLAUDE.md", context))
=> ["../beebox-clerk/CLAUDE.md",true]

JSON.stringify(resolveExternalRef("missing-package/CLAUDE.md", context))
=> ["missing-package/CLAUDE.md",false]

JSON.stringify(resolveExternalRef("../outside-the-monorepo.md", context))
=> ["../outside-the-monorepo.md",false]
```
