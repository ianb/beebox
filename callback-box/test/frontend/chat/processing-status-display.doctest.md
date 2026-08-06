# Chat processing-status display

The backend `busy` flag remains the send-admission truth, but a busy snapshot
from initial chat bootstrap is not enough by itself to paint "Agent is
working…". The display waits for a status confirmation. A locally streaming
turn remains immediate, and its final history refresh keeps the indicator;
only the refresh used to clear a transient bootstrap snapshot stays hidden.

```ts setup
import { shouldShowAgentWorking } from "../../../src/frontend/src/components/chat/processing-status-display.js";
```

## An unconfirmed bootstrap snapshot stays hidden

```ts
shouldShowAgentWorking({ phase: "idle", processBusy: true, confirmation: "unconfirmed" })
=> false

shouldShowAgentWorking({ phase: "idle", processBusy: true, confirmation: "confirmed" })
=> true
```

## Local streaming and normal finalization remain immediate

```ts
shouldShowAgentWorking({ phase: "streaming", processBusy: false, confirmation: "unconfirmed" })
=> true

shouldShowAgentWorking({ phase: "refreshing", processBusy: false, confirmation: "unconfirmed" })
=> true
```

## Clearing a transient snapshot does not flash during history refresh

```ts
shouldShowAgentWorking({ phase: "refreshing", processBusy: true, confirmation: "clearing" })
=> false

shouldShowAgentWorking({ phase: "idle", processBusy: true, confirmation: "clearing" })
=> false

shouldShowAgentWorking({ phase: "idle", processBusy: false, confirmation: "confirmed" })
=> false
```
