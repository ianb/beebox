# Canonical system card identity

```ts setup
import { SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION, systemCardLocationError } from "../../src/shared/system-card-paths.js";
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

JSON.stringify(SYSTEM_CARD_COHORTS[SYSTEM_CARD_MIGRATION])
=> ["dashboard","settings","browse"]

JSON.stringify(SYSTEM_CARD_COHORTS[REMAINING_SYSTEM_CARD_MIGRATION])
=> ["dashboard","settings","browse","questions","landmarks","history","inventory","admin"]

systemCardLocationError("admin", SYSTEM_CARD_PATHS.admin)
=> null

systemCardLocationError("history", "_content/Saved.history.card")?.includes(SYSTEM_CARD_PATHS.history)
=> true
```
