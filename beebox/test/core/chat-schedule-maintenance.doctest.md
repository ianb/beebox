# A due chat timer remains pending while maintenance owns admission

```ts setup
import { ChatScheduleManager, loadChatSchedules } from "../../src/core/chat/schedules.js";
import { closeBoxMaintenance } from "../../src/lib/box-maintenance.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
const box = await makeTmpBox({ git: true });
const maintenance = await closeBoxMaintenance(box.root, { reason: "fixture" });
const fired = Promise.withResolvers();
let count = 0;
const manager = new ChatScheduleManager(box.root, { onFire: () => { count++; fired.resolve(); } });
// Arming under the maintenance context must not give the timer that privilege.
maintenance.run(() => manager.addSchedule({ label: "due", alarm: false, announce: null, content: "run later", durationMs: 0 }));
const deadline = Date.now() + 3000;
while (manager.hasInFlightDeliveries() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
JSON.stringify({ count, pending: loadChatSchedules({ boxRoot: box.root }).length })
=> {"count":0,"pending":1}

await maintenance.drain();
await maintenance.complete();
manager.resumeAfterMaintenance();
await fired.promise;
while (manager.hasInFlightDeliveries() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
JSON.stringify({ count, pending: loadChatSchedules({ boxRoot: box.root }).length })
=> {"count":1,"pending":0}
```

```ts cleanup
manager.stopAll();
await maintenance.release();
await box.cleanup();
```
