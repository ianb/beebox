# Smoke step times

When the smoke walk runs out of its budget, the reader has to tell host load
from a broken step. Load makes every step slower than usual; a broken step is
slow alone. So each step's line in the walk's output gives its own time and,
once the run log holds enough history, its usual (median) time.

```ts setup
import { formatStepTime } from "../smoke-lib.js";

/** A step's history as `--report` folds it from the run log. */
const history = (ran: number, medianSeconds: number) =>
  ({ id: "card-open", ran, failed: 0, injected: 0, medianSeconds, lastFailure: null });
```

With five or more logged runs, the usual time follows the step's own.

```ts
formatStepTime(41_234, history(30, 3.1))
=> 41.2s; usual 3.1s
```

With fewer runs, a median is noise, so only the step's own time is shown. A
step that has never run has no history at all.

```ts
[formatStepTime(2_000, history(4, 3.1)), formatStepTime(2_000, undefined)]
=> ["2.0s", "2.0s"]
```
