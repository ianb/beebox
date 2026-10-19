// # Connector procedure triggers
//
// The lightweight connector-sync command runs procedure requests just like the
// full wakeup path instead of silently discarding them after the connector
// advances its cursor.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { runConnectorSync } from "../../../src/core/commands/connector-sync.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";

void test("line 13", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/connector-review.procedure.card", `---
name: connector-review
description: Record that connector review ran
steps:
  - id: record
    description: Record the trigger
    run:
      shells:
        - mkdir -p _bookkeeping/output && echo reviewed > _bookkeeping/output/connector-review.txt
---
`);
  box.commitAll("add connector procedure");
  const fakeConnector = {
    name: "procedure-source",
    produces: [],
    inboxPaths: [],
    async sync() {
      return {
        success: true,
        created: [],
        updated: [],
        procedures: [{
          procedureRef: "_config/procedures/connector-review.procedure.card",
          directive: "Review the connector event",
        }],
      };
    },
  };
  const collector = createCollectorContext(box.root);
  const result = await runConnectorSync(collector.ctx, {
    syncArgs: { connector: "procedure-source" },
    connectors: [fakeConnector],
  });
  t.check(result, { success: true, data: { created: 0, errors: 0 } });

  await t.checkText(collector.getOutput(), `Syncing procedure-source...
  No new items.
Running procedure _config/procedures/connector-review.procedure.card...
Starting procedure: connector-review
Run: _bookkeeping/procedure/runs/connector-review_«*»
«blankline»
=== Step: record ===
Record the trigger
«blankline»
  Running shell command...
✓ Step completed: record
«blankline»
✓ Procedure completed: connector-review
«blankline»
Total: 0 created, 0 errors.`);

  t.check((await box.read("_bookkeeping/output/connector-review.txt")).trim(), "reviewed");
});
