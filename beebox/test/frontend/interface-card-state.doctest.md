# Inventory and Admin card state

```ts setup
import { parseInventoryCardState, inventoryCardViewState } from "../../src/frontend/src/lib/inventory-card-state.js";
import { adminArrivalKey, adminArrivalReceipt, adminArrivalViewState, clearAdminArrivalState, parseAdminCardState, shouldAcknowledgeAdminArrival, shouldConsumeAdminArrival } from "../../src/frontend/src/lib/admin-card-state.js";
import { boxRouteSurface } from "../../src/frontend/src/lib/box-route-layout.js";
import { captureModeForRequest } from "../../src/frontend/src/lib/capture-intent.js";
```

```ts
JSON.stringify(parseInventoryCardState(null))
=> {"ok":true,"state":{"projection":"grouped","metric":"count","linkStatus":"all"}}

JSON.stringify(parseInventoryCardState({ projection: "direct", metric: "bytes", linkStatus: "unlinked" }))
=> {"ok":true,"state":{"projection":"direct","metric":"bytes","linkStatus":"unlinked"}}

parseInventoryCardState({ projection: "other" }).ok
=> false

JSON.stringify(inventoryCardViewState({ projection: "grouped", metric: "bytes", linkStatus: "linked" }))
=> {"projection":"grouped","metric":"bytes","linkStatus":"linked"}
```

Only recognized OAuth return fields become renderer state. Authorization codes
remain backend-only, and consumption preserves unrelated future Admin state.

```ts
JSON.stringify(adminArrivalViewState({ google: "error", message: "Denied", reconnect: "google", code: "secret", session: "chosen" }))
=> {"google":"error","message":"Denied","reconnect":"google"}

JSON.stringify(parseAdminCardState({ google: "connected", message: "Ready" }))
=> {"ok":true,"arrival":{"google":"connected","message":"Ready"}}

parseAdminCardState({ google: "maybe" }).ok
=> false

JSON.stringify(clearAdminArrivalState({ google: "error", message: "Denied", reconnect: "google", panel: "future" }))
=> {"panel":"future"}
```

A hidden retained Admin card and an in-flight status request cannot consume the
arrival. Clearing the target resets the processed key, so an identical later
OAuth return is handled again.

```ts
const arrival = { google: "error", message: "Denied" } as const;
const key = adminArrivalKey(arrival);
shouldConsumeAdminArrival({ arrival, visible: false, loading: false, alreadyProcessed: false })
=> false

shouldConsumeAdminArrival({ arrival, visible: true, loading: true, alreadyProcessed: false })
=> false

shouldConsumeAdminArrival({ arrival, visible: true, loading: false, alreadyProcessed: false })
=> true

adminArrivalReceipt(7, arrival) === adminArrivalReceipt(7, arrival)
=> true

adminArrivalReceipt(8, arrival) === adminArrivalReceipt(7, arrival)
=> false

shouldConsumeAdminArrival({ arrival, visible: true, loading: false, alreadyProcessed: key !== null })
=> false

shouldAcknowledgeAdminArrival({ arrival, visible: true, loading: false })
=> true

shouldConsumeAdminArrival({ arrival, visible: true, loading: false, alreadyProcessed: false })
=> true
```

Dev fixtures are the only box paths classified outside product runtime.

```ts
JSON.stringify([boxRouteSurface("/dev/speech"), boxRouteSurface("/dev/capture-mode"), boxRouteSurface("/views/_config/interface/admin.card"), boxRouteSurface("/unknown")])
=> ["dev-harness","dev-harness","product","product"]
```

A later capture request reopens a retained chat runtime; absence of a request
does not itself close capture mode.

```ts
JSON.stringify([captureModeForRequest(false, true), captureModeForRequest(true, true), captureModeForRequest(true, false), captureModeForRequest(false, false)])
=> [true,true,true,false]
```
