# Connector procedure triggers

The lightweight connector-sync command runs procedure requests just like the
full wakeup path instead of silently discarding them after the connector
advances its cursor.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { registerConnector } from "../../../src/connectors/index.js";
import {
  createCollectorContext,
  runCommand,
} from "../../../src/core/commands/index.js";
```

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/connector-review.procedure.card", `---
name: connector-review
description: Record that connector review ran
steps:
  - id: record
    description: Record the trigger
    run:
      shells:
        - mkdir -p box/output && echo reviewed > box/output/connector-review.txt
---
`);
box.commitAll("add connector procedure");
registerConnector({
  name: "procedure-source",
  produces: [],
  inboxPaths: [],
  async sync() {
    return {
      success: true,
      created: [],
      updated: [],
      procedures: [{
        procedureRef: "config/procedures/connector-review.procedure.card",
        directive: "Review the connector event",
      }],
    };
  },
});
const collector = createCollectorContext(box.root);
const result = await runCommand({
  name: "connector-sync",
  args: { connector: "procedure-source" },
  ctx: collector.ctx,
});
result.success
=> true

collector.getOutput().includes("Running procedure config/procedures/connector-review.procedure.card")
=> true

(await box.read("box/output/connector-review.txt")).trim()
=> reviewed
```

```ts cleanup
await box.cleanup();
```
