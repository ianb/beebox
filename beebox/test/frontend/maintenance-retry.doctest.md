# Waiting out a maintenance refusal

A box closed for maintenance answers a chat send with 503 and, when it knows
its drain deadline, `Retry-After` in seconds. The client parks the message for
that long and sends once more; without a usable deadline it fails as before.

```ts setup
import { maintenanceRetryDelayMs } from "../../src/frontend/src/lib/maintenance-retry.js";
```

```ts
maintenanceRetryDelayMs("90")
=> 90000

// Below the floor, still a real wait: never a hot retry loop.
maintenanceRetryDelayMs("0")
=> 1000

// No header, or one that is not a number of seconds: no retry.
maintenanceRetryDelayMs(null)
=> null

maintenanceRetryDelayMs("Wed, 21 Oct 2026 07:28:00 GMT")
=> null

// Longer than the gate's own drain limit is not worth parking a message on.
maintenanceRetryDelayMs("601")
=> null
```
