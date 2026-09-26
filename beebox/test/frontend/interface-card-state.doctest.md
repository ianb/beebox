# Inventory and Admin card state

```ts setup
import { parseInventoryCardState, inventoryCardViewState } from "../../src/frontend/src/lib/inventory-card-state.js";
import { adminArrivalKey, adminArrivalReceipt, adminArrivalViewState, adminTabViewState, clearAdminArrivalState, parseAdminCardState, shouldAcknowledgeAdminArrival, shouldConsumeAdminArrival } from "../../src/frontend/src/lib/admin-card-state.js";
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

Only recognized OAuth return fields and a known tab become renderer state.
Authorization codes remain backend-only, and consuming the arrival keeps the
open tab and any unrelated future Admin state.

```ts
JSON.stringify(adminArrivalViewState({ google: "error", message: "Denied", reconnect: "google", code: "secret", session: "chosen", tab: "connections" }))
=> {"google":"error","message":"Denied","reconnect":"google","tab":"connections"}

JSON.stringify(adminArrivalViewState({ tab: "nowhere" }))
=> null

JSON.stringify(parseAdminCardState({ google: "connected", message: "Ready" }))
=> {"ok":true,"arrival":{"google":"connected","message":"Ready"},"tab":null}

JSON.stringify(parseAdminCardState({ tab: "host" }))
=> {"ok":true,"arrival":{},"tab":"host"}

parseAdminCardState({ google: "maybe" }).ok
=> false

parseAdminCardState({ tab: "nowhere" }).ok
=> false

JSON.stringify(clearAdminArrivalState({ google: "error", message: "Denied", reconnect: "google", tab: "host", panel: "future" }))
=> {"tab":"host","panel":"future"}

JSON.stringify(clearAdminArrivalState({ reconnect: "google" }))
=> {"tab":"connections"}

JSON.stringify(clearAdminArrivalState({ panel: "future" }))
=> {"panel":"future"}

JSON.stringify(adminTabViewState({ google: "connected" }, "people"))
=> {"google":"connected","tab":"people"}
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
