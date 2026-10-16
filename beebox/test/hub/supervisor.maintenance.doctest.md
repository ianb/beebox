# Full server replacement retains admission ownership

A disposable Git box runs the real server in real child process groups. Only the
bundle identity file is simulated: changing it drives the server's existing poll,
its IPC request, the supervisor's gate, old-child shutdown, and real replacement
HTTP readiness. No agent is prewarmed and no credential store is changed.

Readiness polls the real server's HTTP, with a budget sized for a loaded test
host rather than the hub's 30-second production `READY_TIMEOUT_MS`. With eight
copies of this file running in parallel, a cold real-server boot took longer
than 30 seconds, and the supervisor killed it before the reload ever started. The
production budget is not what this file tests.

```ts setup
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Supervisor } from "../../src/hub/supervisor/core.js";
import { defaultSpawnChild, type ChildProc } from "../../src/hub/supervisor/child-spawn.js";
import { waitForHttp } from "../../src/hub/child-process-utils.js";
import { acquireBoxWork, boxMaintenanceStatus } from "../../src/lib/box-maintenance/admission.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));
```

```ts
const box = await makeTmpBox({ git: true, deps: true });
const identityFile = box.path(".beebox/fixture-bundle");
await writeFile(identityFile, "generation one");
const children: ChildProc[] = [];
const readiness: Array<{ phase: string | null; code: number | null }> = [];
let accepted: Awaited<ReturnType<typeof acquireBoxWork>> | undefined;
const supervisor = new Supervisor({
  config: { boxes: { fixture: { path: box.root } }, configPath: box.path("hub.json"), port: undefined, host: undefined, lazy: false, idleMs: 300_000, keepRecent: 0 },
  hubSecret: "disposable-fixture-hub-secret",
  async checkReady(params) {
    await waitForHttp({ port: params.port, reqPath: "/api/build-info", timeoutMs: 120_000, label: params.label });
    const phase = (await boxMaintenanceStatus(box.root))?.phase ?? null;
    const code = phase === "ready" ? (await fetch(`http://127.0.0.1:${params.port}/fixture/not-a-route`, { method: "POST" })).status : null;
    readiness.push({ phase, code });
  },
  spawnChild(params) {
    const info = statSync(identityFile, { bigint: true });
    const child = defaultSpawnChild({
      bbxBinary: process.execPath,
      args: ["--import", "tsx", join(import.meta.dirname, "../helpers/maintenance-server-child.ts"), box.root, ...params.args.slice(-1)],
      cwd: join(import.meta.dirname, "../.."),
      env: { ...params.env, BBX_DEV_BUNDLE_PATH: identityFile, BBX_DEV_BUNDLE_ID: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}` },
    });
    children.push(child);
    return child;
  },
});
await supervisor.startAll();
supervisor.getStatuses()[0]?.status
=> running

const first = supervisor.getStatuses()[0];
accepted = await acquireBoxWork(box.root, { reason: "test" });
await writeFile(identityFile, "generation two is different");
const deadline = Date.now() + 120_000;
while ((await boxMaintenanceStatus(box.root)) === null && Date.now() < deadline) await delay();
(await boxMaintenanceStatus(box.root))?.phase
=> draining

children.length
=> 1

(await fetch(`http://127.0.0.1:${first?.port}/fixture/not-a-route`, { method: "POST" })).status
=> 503

await accepted.release();
while ((children.length < 2 || supervisor.getStatuses()[0]?.status !== "running" || (await boxMaintenanceStatus(box.root)) !== null) && Date.now() < deadline) await delay();
const next = supervisor.getStatuses()[0];
next?.status === "running" && next.pid !== first?.pid
=> true

children[0]?.exitCode
=> 75

JSON.stringify(readiness)
=> [{"phase":null,"code":null},{"phase":"ready","code":503}]


await boxMaintenanceStatus(box.root)
=> null

(await fetch(`http://127.0.0.1:${next?.port}/api/build-info`)).status
=> 200
```

```ts cleanup
await accepted?.release();
await supervisor.stopAll();
await box.cleanup();
```
