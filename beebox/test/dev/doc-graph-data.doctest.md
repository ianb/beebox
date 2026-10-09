# Documentation graph external-reference resolution

Monorepo documents outside the external-source scan roots are still valid link
targets. Resolving one does not require adding it to the source scan, while a
missing target or a relative path that escapes the monorepo stays unresolved.

```ts setup
import { resolveExternalRef, type ExternalResolveContext } from "../../src/dev/doc-graph-data/data.js";

const context: ExternalResolveContext = {
  fromFile: "AGENTS.md",
  internalFiles: [],
  externalFiles: [],
  internalBasenames: new Map(),
  externalBasenames: new Map(),
};
```

```ts
JSON.stringify(resolveExternalRef("beebox-clerk/AGENTS.md", context))
=> ["../beebox-clerk/AGENTS.md",true]

JSON.stringify(resolveExternalRef("missing-package/AGENTS.md", context))
=> ["missing-package/AGENTS.md",false]

JSON.stringify(resolveExternalRef("../outside-the-monorepo.md", context))
=> ["../outside-the-monorepo.md",false]
```
