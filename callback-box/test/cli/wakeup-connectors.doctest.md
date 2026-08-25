# Wakeup connector failure accounting

`cb wakeup` lets independent connectors finish, then reports one aggregate
failure status after the rest of the wakeup phases. Connector result errors,
thrown sync errors, and failed connector procedure triggers all contribute to
that final status.

```ts setup
import {
  runConnectors,
  wakeupExitCodeForConnectorErrors,
} from "../../src/cli/commands/wakeup-connectors.js";
import type { Connector } from "../../src/connectors/index.js";

function connector(
  name: string,
  sync: Connector["sync"],
): Connector {
  return { name, produces: [], inboxPaths: [], sync };
}

async function captureOutput<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
```

## Every recoverable error source is counted after all connectors run

The first connector returns an ordinary `SyncResult` error, the second throws,
and the third succeeds while requesting a procedure. All three run; the
injected procedure runner sees the request and contributes its own failure.

```ts
const ran: string[] = [];
const procedureRefs: string[] = [];
const connectors = [
  connector("result-error", async () => {
    ran.push("result-error");
    return { success: false, created: [], updated: [], error: "partial" };
  }),
  connector("thrown-error", async () => {
    ran.push("thrown-error");
    throw new Error("offline");
  }),
  connector("procedure-error", async () => {
    ran.push("procedure-error");
    return {
      success: true,
      created: [],
      updated: [],
      procedures: [{ procedureRef: "procedure/test", directive: "run" }],
    };
  }),
];

const result = await captureOutput(() => runConnectors("/unused", {
  connectors,
  runProcedureTriggers: async (procedures) => {
    procedureRefs.push(...procedures.map((procedure) => procedure.procedureRef));
    return 1;
  },
}));

JSON.stringify({
  ran,
  procedureRefs,
  errorCount: result.errorCount,
  activeConnector: result.activeConnector?.name ?? null,
})
=> {"ran":["result-error","thrown-error","procedure-error"],"procedureRefs":["procedure/test"],"errorCount":3,"activeConnector":null}
```

## Scoped runs still return their active connector and error count

```ts
const only = connector("only", async () => ({
  success: false,
  created: [],
  updated: [],
  error: "failed",
}));
const result = await captureOutput(() => runConnectors("/unused", {
  connector: "only",
  connectors: [only],
  runProcedureTriggers: async () => 0,
}));
JSON.stringify({
  activeConnector: result.activeConnector?.name,
  errorCount: result.errorCount,
})
=> {"activeConnector":"only","errorCount":1}
```

## An unknown `--connector` name is folded into the error count, not a process exit

Naming a connector that doesn't match any configured connector must not abort
the cycle mid-run: the caller (`cb wakeup`) still needs to run stale-job
cleanup, intake, the reactor, and the final push. `runConnectors` reports the
miss the same way it reports any other connector failure — through
`errorCount` — so the process only exits nonzero after every later wakeup
phase has had a chance to run.

```ts
const configured = connector("configured", async () => ({
  success: true,
  created: [],
  updated: [],
}));
const result = await captureOutput(() => runConnectors("/unused", {
  connector: "nonexistent",
  connectors: [configured],
  runProcedureTriggers: async () => 0,
}));
JSON.stringify({
  activeConnector: result.activeConnector?.name ?? null,
  errorCount: result.errorCount,
})
=> {"activeConnector":null,"errorCount":1}
```

## Only a nonzero connector error count requests a failing process status

The command applies this value after stale-job cleanup, intake, indexing,
reactor work, and push. Returning `undefined` for a clean connector phase means
the helper never clears an exit status established by some other phase.

```ts
JSON.stringify([
  wakeupExitCodeForConnectorErrors(0) ?? null,
  wakeupExitCodeForConnectorErrors(1),
  wakeupExitCodeForConnectorErrors(3),
])
=> [null,1,1]
```
