# Triage run allowance

The run quota is shared with subprocesses, reserves comparisons all-or-none,
and rejects inherited IDs after cleanup. It does not mutate the parent's env.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { withTriageAllowance, reserveRunCalls } from "../../../src/core/triage/allowance.js";
```

```ts
const box = await fs.mkdtemp(path.join(os.tmpdir(), "triage-allowance-"));
let runId = "";
const failures = await withTriageAllowance(box, async env => {
  runId = env.BBX_TRIAGE_RUN_ID;
  await reserveRunCalls(box, 31);
  const first = await reserveRunCalls(box, 2).catch(error => error.name);
  await reserveRunCalls(box, 1);
  const second = await reserveRunCalls(box, 1).catch(error => error.name);
  return [first, second];
});
JSON.stringify(failures)
=> ["TriageAllowanceError","TriageAllowanceError"]

await fs.readdir(path.join(box, ".beebox/triage-runs"))
=> []

process.env.BBX_TRIAGE_RUN_ID === runId
=> false
```

```ts cleanup
await fs.rm(box, {recursive: true, force: true});
```

## Cross-process reservation, expiry, and cleanup

Separate CLI processes compete for one allowance. A rejected multi-call
reservation spends nothing; research cannot spend more than its sub-limit even
when the overall run has calls left. No parent process environment is changed.

```ts setup
import { execa } from "execa";
import { pathToFileURL } from "node:url";
const allowanceModule = pathToFileURL(path.resolve("src/core/triage/allowance.ts")).href;
async function childReserve(root: string, env: Record<string, string>, count: number): Promise<string> {
  const script = 'import {reserveRunCalls} from ' + JSON.stringify(allowanceModule) + '; try { await reserveRunCalls(process.argv[1], Number(process.argv[2])); console.log("reserved"); } catch (error) { console.log(error.name); }';
  const child = await execa(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, root, String(count)], { env });
  return child.stdout;
}
```

```ts
const box = await fs.mkdtemp(path.join(os.tmpdir(), "triage-allowance-"));
let inherited: Record<string, string> = {};
const before = process.env.BBX_TRIAGE_RUN_ID;
const results = await withTriageAllowance(box, async env => {
  inherited = env;
  const concurrent = await Promise.all([childReserve(box, env, 7), childReserve(box, env, 7)]);
  const remainder = await childReserve(box, env, 5);
  const exhausted = await childReserve(box, env, 1);
  await reserveRunCalls(box, 20);
  const quota = JSON.parse(await fs.readFile(path.join(box, ".beebox/triage-runs", env.BBX_TRIAGE_RUN_ID + ".json"), "utf8"));
  return { concurrent: concurrent.toSorted(), remainder, exhausted, remaining: quota.remaining, researchRemaining: quota.researchRemaining };
});
JSON.stringify(results)
=> {"concurrent":["TriageAllowanceError","reserved"],"remainder":"reserved","exhausted":"TriageAllowanceError","remaining":0,"researchRemaining":0}

await childReserve(box, inherited, 1)
=> Error

process.env.BBX_TRIAGE_RUN_ID === before
=> true

await fs.readdir(path.join(box, ".beebox/triage-runs"))
=> []

const expired = await withTriageAllowance(box, async env => {
  const file = path.join(box, ".beebox/triage-runs", env.BBX_TRIAGE_RUN_ID + ".json");
  const quota = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, JSON.stringify({ ...quota, expires: 0 }));
  return childReserve(box, env, 1);
});
expired
=> TriageAllowanceError

await fs.readdir(path.join(box, ".beebox/triage-runs"))
=> []

const failed = await withTriageAllowance(box, async () => { throw new Error("synthetic research failure"); }).catch(error => error.message);
failed
=> synthetic research failure

await fs.readdir(path.join(box, ".beebox/triage-runs"))
=> []
```

```ts cleanup
await fs.rm(box, {recursive: true, force: true});
```
