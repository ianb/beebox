# Canonical system card identity

```ts setup
import { systemCardLocationError } from "../../src/shared/system-card-paths.js";
import { typeFromFilename } from "../../src/core/card-io.js";
```

Bare filenames infer the type. Equivalent safe paths normalize through the shared resolver.
Copies and escaping paths cannot create another working instrument.

```ts
JSON.stringify([typeFromFilename("dashboard.card"), typeFromFilename("Copy.dashboard.card")])
=> ["dashboard","dashboard"]

systemCardLocationError("dashboard", "/_config/interface/./dashboard.card")
=> null

systemCardLocationError("dashboard", "_content/Copy.dashboard.card")?.includes("_config/interface/dashboard.card")
=> true

systemCardLocationError("dashboard", "../_config/interface/dashboard.card") !== null
=> true
```
