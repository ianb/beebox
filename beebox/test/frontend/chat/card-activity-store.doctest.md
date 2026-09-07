# Source-scoped activity stays available until acceptance

A cancelled or failed send needs no restoration: capture did not erase anything.
Switching subjects cannot carry old activity onto the new card, and an older
receipt cannot erase activity recorded after its send gesture.

```ts setup
import { CardActivityStore } from "../../../src/frontend/src/components/chat/conversation/card-activity-store.js";
```

```ts
const activity = new CardActivityStore();
const first = "_content/house/Energy.doc.card?view=costs";
const second = "_content/kitchen/Plan.doc.card";
activity.report(first, { kind: "modified", detail: "Updated cost" });
const cancelled = activity.capture(first);
JSON.stringify(activity.capture(first).cardActivity)
=> ["modified"]

JSON.stringify(activity.capture(second))
=> {"openCard":"_content/kitchen/Plan.doc.card"}

activity.report(second, { kind: "scrolled", detail: "0.7" });
activity.report(first, { kind: "modified", detail: "Updated cost again" });
activity.accepted(cancelled);
activity.capture(first).cardState?.modified
=> Updated cost again

activity.capture(second).cardState?.scrolled
=> 0.7

const final = activity.capture(first);
activity.accepted(final);
activity.capture(first).cardActivity
=> undefined

activity.capture(second).cardState?.scrolled
=> 0.7

activity.capture("_content/house/Energy.doc.card?view=summary").cardActivity
=> undefined

JSON.stringify(activity.capture(undefined))
=> {}
```
