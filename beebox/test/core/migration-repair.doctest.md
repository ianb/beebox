# Bounded migration repair

The deterministic retry owns completion. A durable question stops another agent
attempt; an interrupted receipt also becomes a question instead of a replay.

```ts setup
import { execFileSync } from "node:child_process";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { captureMigrationSnapshot } from "../../src/core/migration-recovery.js";
import { repairMigration, finishMigrationRepair, migrationQuestions } from "../../src/core/migration-repair.js";
```

```ts
const box = await makeTmpBox({ git: true });
const snapshot = await captureMigrationSnapshot(box.root, "probe");
let invocations = 0;
let retries = 0;
const opts = {
  boxRoot: box.root, name: "probe", recoveryRef: snapshot.ref, failure: "invalid card", code: 2,
  retry: async () => { retries += 1; return 2; },
  agent: { invokeStructured: async (_schema, args) => {
    invocations += 1;
    if (args.maxTurns !== 12) throw new Error("Unbounded repair");
    return { success: true, sessionId: "test-session", data: { status: "needs-human", reason: "Which divergent content should be kept?" } };
  } },
};
const first = await repairMigration(opts);
await box.commitAll("record repair question");
await finishMigrationRepair(box.root, "probe");
const second = await repairMigration(opts);
JSON.stringify({ invocations, retries, sameQuestion: first.question === second.question, pending: (await migrationQuestions(box.root)).length })
=> {"invocations":1,"retries":1,"sameQuestion":true,"pending":1}
```

```ts cleanup
await box.cleanup();
```

```ts
const box = await makeTmpBox({ git: true });
const snapshot = await captureMigrationSnapshot(box.root, "interrupted");
execFileSync("git", ["update-ref", "refs/bbx/migrations/interrupted/repair-started", snapshot.ref], { cwd: box.root });
let invoked = false;
const result = await repairMigration({
  boxRoot: box.root, name: "interrupted", recoveryRef: snapshot.ref, failure: "interrupted", code: 1,
  retry: async () => 0,
  agent: { invokeStructured: async () => { invoked = true; } },
});
JSON.stringify({ invoked, question: Boolean(result.question), code: result.code })
=> {"invoked":false,"question":true,"code":1}
```

```ts cleanup
await box.cleanup();
```

```ts
const box = await makeTmpBox({ git: true });
const snapshot = await captureMigrationSnapshot(box.root, "unavailable");
await repairMigration({
  boxRoot: box.root, name: "unavailable", recoveryRef: snapshot.ref, failure: "invalid", code: 1,
  retry: async () => 0,
  agent: { invokeStructured: async () => ({ success: false, invocationFailure: true, error: "unavailable", sessionId: "" }) },
})
=> throws MigrationRepairUnavailableError

execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/bbx/migrations/unavailable/repair-started"], { cwd: box.root }).toString().trim() === ""
=> true
```

```ts cleanup
await box.cleanup();
```
