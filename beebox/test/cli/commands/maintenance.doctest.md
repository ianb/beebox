# Deployment ownership survives its child command

Use real Git boxes and a real child process. The child sees both boxes closed,
can join only its own fleet permits, and declares readiness without reopening.
Only the controller reopens after the trusted verification command succeeds.
This exercises the current-user path; production's temporary root privilege
restoration needs a Linux root fixture as well.

```ts setup
import { join, dirname } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { defaultHubConfigPath } from "../../../src/hub/hub-config.js";
import { pathToFileURL } from "node:url";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runMaintenance } from "../../../src/cli/commands/maintenance.js";
import { boxMaintenanceStatus } from "../../../src/lib/box-maintenance.js";
const library = pathToFileURL(join(import.meta.dirname, "../../../src/lib/box-maintenance.ts")).href;
const readyScript = `
const { acquireBoxMaintenance, boxMaintenanceStatus, acquireBoxWork } = await import(${JSON.stringify(library)});
const roots = Object.keys(JSON.parse(process.env.BBX_MAINTENANCE_PERMITS));
for (const root of roots) {
  if ((await boxMaintenanceStatus(root)).phase !== "exclusive") throw Error("not closed");
  try { await acquireBoxWork(root, { reason: "test" }); throw Error("admitted"); }
  catch (error) { if (error.name !== "BoxMaintenanceError") throw error; }
}
for (const root of roots) {
  const nested = await acquireBoxMaintenance(root, { reason: "fixture", join: true });
  await nested.prepare();
  if ((await boxMaintenanceStatus(root)).phase !== "ready") throw Error("opened early");
}
`;
```

```ts
const previousKey = process.env.BBX_DIAG_API_KEY;
const configPath = defaultHubConfigPath();
let canary;
const one = await makeTmpBox({ git: true });
const two = await makeTmpBox({ git: true });
await one.write("input.txt", "valuable draft");
one.commitAll("initial");
await two.write("input.txt", "another draft");
two.commitAll("initial");
await one.write("input.txt", "dirty valuable draft");
const invoke = (script: string, verifyHub?: string) => runMaintenance([two.root, one.root], {
  command: process.execPath,
  ...(verifyHub ? { verifyHub } : {}),
  args: ["--import", "tsx", "--input-type=module", "-e", script],
});
await invoke(readyScript)
=> 0

await boxMaintenanceStatus(one.root)
=> null

await boxMaintenanceStatus(two.root)
=> null

await invoke(readyScript + "\nprocess.exitCode = 1;")
=> 1

(await boxMaintenanceStatus(one.root)).phase
=> exclusive

(await boxMaintenanceStatus(two.root)).phase
=> exclusive

await invoke(readyScript)
=> 0

await boxMaintenanceStatus(one.root)
=> null

process.env.BBX_DIAG_API_KEY = "fixture-diag";
await mkdir(dirname(configPath), { recursive: true });
await writeFile(configPath, JSON.stringify({ boxes: { one: { path: one.root }, two: { path: two.root } } }));
const verified = [];
canary = createServer((request, response) => {
  const slug = new URL(request.url, "http://localhost").searchParams.get("box");
  verified.push(slug);
  const ok = slug === "one" && request.headers.authorization === "Bearer fixture-diag";
  response.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: ok ? "ok" : "canary-failed", slug }));
});
canary.listen(0, "127.0.0.1");
await once(canary, "listening");
await invoke(readyScript + "\nprocess.exitCode = 1;", `http://127.0.0.1:${canary.address().port}`)
=> 1

await boxMaintenanceStatus(one.root)
=> null

(await boxMaintenanceStatus(two.root)).phase
=> exclusive

JSON.stringify(verified.toSorted())
=> ["one","two"]

```

```ts cleanup
if (canary) await new Promise((resolve) => canary.close(resolve));
await rm(configPath, { force: true });
if (previousKey === undefined) delete process.env.BBX_DIAG_API_KEY;
else process.env.BBX_DIAG_API_KEY = previousKey;
await one.cleanup();
await two.cleanup();
```
