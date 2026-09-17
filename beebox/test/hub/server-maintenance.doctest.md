# Full server replacement retains admission ownership

A disposable Git box runs the real server in real child process groups. Only the
bundle identity file is simulated: changing it drives the server's existing poll,
its IPC request, the supervisor's gate, old-child shutdown, and real replacement
HTTP readiness. No agent is prewarmed and no credential store is changed.

```ts setup
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Supervisor } from "../../src/hub/supervisor.js";
import { defaultSpawnChild, defaultCheckReady } from "../../src/hub/child-spawn.js";
import { acquireBoxWork, boxMaintenanceStatus } from "../../src/lib/box-maintenance.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));
```

```ts
const box = await makeTmpBox({ git: true, deps: true });
const identityFile = box.path(".beebox/fixture-bundle");
await writeFile(identityFile, "generation one");
const children = [];
const readiness = [];
let accepted;
const supervisor = new Supervisor({
  config: { boxes: { fixture: { path: box.root } }, configPath: box.path("hub.json"), port: undefined, host: undefined },
  hubSecret: "disposable-fixture-hub-secret",
  async checkReady(params) {
    await defaultCheckReady(params);
    const phase = (await boxMaintenanceStatus(box.root))?.phase ?? null;
    const code = phase === "ready" ? (await fetch(`http://127.0.0.1:${params.port}/fixture/not-a-route`, { method: "POST" })).status : null;
    readiness.push({ phase, code });
  },
  spawnChild(params) {
    const info = statSync(identityFile, { bigint: true });
    const child = defaultSpawnChild({
      bbxBinary: process.execPath,
      args: ["--import", "tsx", join(import.meta.dirname, "../helpers/maintenance-server-child.ts"), box.root, params.args.at(-1)],
      cwd: join(import.meta.dirname, "../.."),
      env: { ...params.env, BBX_DEV_BUNDLE_PATH: identityFile, BBX_DEV_BUNDLE_ID: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}` },
    });
    children.push(child);
    return child;
  },
});
await supervisor.startAll();
supervisor.getStatuses()[0].status
=> running

const first = supervisor.getStatuses()[0];
accepted = await acquireBoxWork(box.root, { reason: "test" });
await writeFile(identityFile, "generation two is different");
const deadline = Date.now() + 60000;
while ((await boxMaintenanceStatus(box.root)) === null && Date.now() < deadline) await delay();
(await boxMaintenanceStatus(box.root)).phase
=> draining

children.length
=> 1

(await fetch(`http://127.0.0.1:${first.port}/fixture/not-a-route`, { method: "POST" })).status
=> 503

await accepted.release();
while ((children.length < 2 || supervisor.getStatuses()[0].status !== "running" || (await boxMaintenanceStatus(box.root)) !== null) && Date.now() < deadline) await delay();
const next = supervisor.getStatuses()[0];
next.status === "running" && next.pid !== first.pid
=> true

children[0].exitCode
=> 75

JSON.stringify(readiness)
=> [{"phase":null,"code":null},{"phase":"ready","code":503}]


await boxMaintenanceStatus(box.root)
=> null

(await fetch(`http://127.0.0.1:${next.port}/api/build-info`)).status
=> 200
```

```ts cleanup
await accepted?.release();
await supervisor.stopAll();
await box.cleanup();
```
