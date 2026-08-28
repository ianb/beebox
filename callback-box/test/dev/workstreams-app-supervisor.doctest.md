# Resident workstreams app supervisor

The dev router owns one resident workstreams app without folding it into the
lazy per-worktree lifecycle. The app stays behind the router's existing owner
gate and receives a fresh private capability on every generation.

```ts setup
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { classifyRouterRoute } from "../../../bin/router-auth.js";
import {
  prepareWorkstreamsAppHeaders,
  renderWorkstreamsAppFallback,
  writeDeny,
} from "../../../bin/router.js";
import {
  EXHIBITS_DEFAULT_PORT,
  createWorkstreamsAppSupervisor,
  fingerprintWorkstreamsApp,
  renderExhibitsFallback,
  shouldRestartWorkstreamsBackend,
  type WorkstreamsAppChild,
  type WorkstreamsAppEffects,
  type WorkstreamsAppSpawnOptions,
  type WorkstreamsAppTimer,
} from "../../../bin/workstreams-app-supervisor.js";

type Exit = { code: number | null; signal: NodeJS.Signals | null };

interface FakeChild extends WorkstreamsAppChild {
  fire(exit?: Exit): void;
}

function fakeChild(pid: number): FakeChild {
  const listeners: Array<(exit: Exit) => void> = [];
  let resolveExit: (exit: Exit) => void = () => {};
  const exited = new Promise<Exit>((resolve) => { resolveExit = resolve; });
  return {
    pid,
    exited,
    onExit: (listener) => listeners.push(listener),
    fire: (exit = { code: 0, signal: null }) => {
      resolveExit(exit);
      for (const listener of listeners) listener(exit);
    },
  };
}

interface FakeTimerRecord extends WorkstreamsAppTimer {
  ms: number;
  repeat: boolean;
  active: boolean;
  callback(): void;
}

function makeEffects() {
  let nextPort = 4100;
  let nextPid = 9000;
  let nextSecret = 1;
  let fingerprint = "fingerprint-a";
  let activeJobs = 0;
  let lastBuildId = "";
  let watchChange: ((relativePath: string | null) => void) | null = null;
  const children: FakeChild[] = [];
  const timers: FakeTimerRecord[] = [];
  const spawnOptions: WorkstreamsAppSpawnOptions[] = [];
  const stopped: number[][] = [];
  const exhibitsEvents: string[] = [];
  let exhibitsRender: (() => string) | null = null;
  let holdFailures = 0;

  function timer(ms: number, callback: () => void, repeat: boolean): FakeTimerRecord {
    const record: FakeTimerRecord = {
      ms,
      repeat,
      active: true,
      callback,
      cancel: () => { record.active = false; },
    };
    timers.push(record);
    return record;
  }

  function spawn(options: WorkstreamsAppSpawnOptions): FakeChild {
    spawnOptions.push(options);
    lastBuildId = options.buildId;
    const child = fakeChild(nextPid++);
    children.push(child);
    return child;
  }

  const effects: WorkstreamsAppEffects = {
    now: () => 1_000,
    prepare: async () => {},
    getPort: async () => nextPort++,
    randomCapability: () => `capability-${nextSecret++}`,
    randomBuildId: () => `build-${nextSecret++}`,
    spawnBackend: spawn,
    spawnFrontend: spawn,
    stopChildren: async (toStop) => {
      stopped.push(toStop.map((child) => child.pid ?? -1));
      // Recorded in the same list as the port events: the ORDER of stop
      // against hold is the property that keeps the fallback bindable.
      exhibitsEvents.push("stop");
      for (const child of toStop) {
        const fake = children.find((candidate) => candidate === child);
        fake?.fire({ code: null, signal: "SIGTERM" });
      }
    },
    waitUntilReady: async () => ({ status: "ready", activeJobs, buildId: lastBuildId }),
    readHealth: async () => ({ status: "ready", activeJobs, buildId: lastBuildId }),
    exhibitsToken: async () => "exhibits-token-abcdefghijklmnop",
    holdExhibitsPort: async (options) => {
      if (holdFailures > 0) {
        holdFailures--;
        exhibitsEvents.push("hold-failed");
        throw new Error("listen EADDRINUSE: address already in use 127.0.0.1:3230");
      }
      exhibitsEvents.push(`hold:${String(options.port)}`);
      exhibitsRender = options.render;
      return {
        release: async () => {
          exhibitsEvents.push("release");
          exhibitsRender = null;
        },
      };
    },
    fingerprint: async () => fingerprint,
    watch: (_root, { onChange }) => {
      watchChange = onChange;
      return { close: () => { watchChange = null; } };
    },
    setTimer: (ms, callback) => timer(ms, callback, false),
    setInterval: (ms, callback) => timer(ms, callback, true),
    recordGeneration: async () => {},
    removeGeneration: async () => {},
  };

  async function fireTimer(ms: number): Promise<void> {
    const ready = timers.filter((entry) => entry.active && entry.ms === ms);
    for (const entry of ready) {
      if (!entry.repeat) entry.active = false;
      entry.callback();
    }
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    effects,
    children,
    spawnOptions,
    stopped,
    exhibitsEvents,
    exhibitsFallback: () => exhibitsRender?.() ?? null,
    settle,
    setActiveJobs: (count: number) => { activeJobs = count; },
    /** Make the next N binds fail the way a not-yet-released port does. */
    setHoldFailures: (count: number) => { holdFailures = count; },
    setFingerprint: (value: string) => { fingerprint = value; },
    triggerWatch: (relativePath: string | null) => watchChange?.(relativePath),
    fireTimer,
  };
}
```

## Fail-closed route classification

The resident app is the only workstreams renderer. tRPC queries are `dev-read`
(owner session OR the browse key, since 2026-08-24), while mutations require the
owner plus the existing same-origin check. Unknown verbs stay denied.

```ts
assert.deepEqual(
  classifyRouterRoute({ method: "GET", url: "/workstreams/api/trpc/workstreams.list" }),
  { kind: "dev-read" },
);
assert.deepEqual(
  classifyRouterRoute({ method: "POST", url: "/workstreams/api/trpc/issues.save" }),
  { kind: "control" },
);
assert.deepEqual(
  classifyRouterRoute({ method: "PUT", url: "/workstreams/api/trpc/issues.save" }),
  { kind: "unknown" },
);

const redirect = { status: 0, location: "" };
writeDeny(
  { url: "/workstreams/issues/", headers: { accept: "text/html" } } as IncomingMessage,
  // Test-only structural response double implements every method writeDeny uses.
  {
    writeHead: (status: number, headers: Record<string, string>) => {
      redirect.status = status;
      redirect.location = headers.location ?? "";
    },
    end: () => {},
  } as unknown as ServerResponse,
  {
    allow: false,
    status: 401,
    reason: "dev-read-auth-required",
    redirectToLogin: true,
    route: { kind: "dev-read" },
  },
);
assert.equal(redirect.status, 302);
assert.equal(redirect.location, "/main/auth/login?returnTo=%2Fworkstreams%2Fissues%2F");
```

The private capability is injected only after every incoming `x-cb-*` header
has been removed. Cookies and ordinary proxy headers survive.

```ts
const headers = {
  cookie: "session=owner",
  "x-cb-authenticated-email": "forged@example.test",
  "X-CB-WORKSTREAMS-CAPABILITY": "forged",
  "x-forwarded-proto": "https",
};
prepareWorkstreamsAppHeaders(headers, "router-generated");
assert.deepEqual(headers, {
  cookie: "session=owner",
  "x-forwarded-proto": "https",
  "x-cb-workstreams-capability": "router-generated",
});

const viteHeaders = { "x-cb-workstreams-capability": "forged" };
prepareWorkstreamsAppHeaders(viteHeaders, null);
assert.deepEqual(viteHeaders, {});
```

## Startup, routing, and active-job deferral

The first generation exposes separate backend and frontend targets. A backend
change is coalesced for the quiet period. If the health endpoint reports an
active lifecycle job or mutating request, the old generation remains ready and
the restart stays pending until the activity is finished.

```ts
const fake = makeEffects();
const supervisor = createWorkstreamsAppSupervisor(fake.effects, {
  appRoot: "/tmp/fake-workstreams-app",
  logPath: "/tmp/fake-workstreams-app.log",
  log: () => {},
  quietMs: 10,
  activeJobPollMs: 20,
  reconcileMs: 30,
});
await supervisor.start();

assert.equal(supervisor.state().phase, "ready");
assert.deepEqual(supervisor.targetFor("/workstreams/api/trpc/workstreams.list"), {
  port: 4100,
  capability: "capability-1",
  kind: "backend",
});
assert.deepEqual(supervisor.targetFor("/workstreams/assets/index.js"), {
  port: 4101,
  capability: "capability-1",
  kind: "frontend",
});

fake.setActiveJobs(2);
fake.triggerWatch("src/server/app.ts");
await fake.fireTimer(10);
assert.deepEqual(supervisor.state(), {
  phase: "ready",
  changedAt: 1000,
  backendPort: 4100,
  frontendPort: 4101,
  buildId: "build-2",
  activeJobs: 2,
  restartPending: true,
});
assert.equal(fake.spawnOptions.length, 2);

fake.setActiveJobs(0);
await fake.fireTimer(20);
assert.equal(supervisor.state().phase, "ready");
assert.equal(fake.spawnOptions.length, 4);
assert.deepEqual(fake.stopped, [[9000, 9001]]);
assert.deepEqual(supervisor.targetFor("/workstreams/"), {
  port: 4103,
  capability: "capability-3",
  kind: "frontend",
});
```

Frontend-only edits are left to Vite HMR. The periodic fingerprint still
recovers a missed backend watcher event and schedules another app-only restart.

```ts continue
fake.triggerWatch("src/frontend/App.tsx");
await fake.fireTimer(10);
assert.equal(fake.spawnOptions.length, 4);

fake.setFingerprint("fingerprint-b");
await fake.fireTimer(30);
await fake.fireTimer(10);
assert.equal(fake.spawnOptions.length, 6);
assert.deepEqual(fake.stopped.at(-1), [9002, 9003]);
```

An unexpected child exit makes the app unavailable instead of claiming the
request or lifecycle job completed. The buildless fallback exposes state, log,
and retry without depending on the app package.

```ts continue
fake.children.at(-1)!.fire({ code: 9, signal: null });
assert.equal(supervisor.state().phase, "failed");
assert.equal(supervisor.targetFor("/workstreams/"), null);

const fallback = renderWorkstreamsAppFallback(supervisor.state(), "~/.cache/callback-box/logs/workstreams-app.log");
assert.match(fallback, /Workstreams app unavailable/);
assert.match(fallback, /frontend exited unexpectedly \(code 9\)/);
assert.match(fallback, /__router\/retry\/workstreams-app/);
assert.match(fallback, /workstreams-app\.log/);

await supervisor.shutdown();
assert.equal(supervisor.state().phase, "stopped");
```

## Fingerprint scope

The reconciliation fingerprint ignores frontend sources (Vite owns their HMR)
but includes backend and shared contracts.

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-supervisor-"));
await fs.mkdir(path.join(root, "src/frontend"), { recursive: true });
await fs.mkdir(path.join(root, "src/server"), { recursive: true });
await fs.writeFile(path.join(root, "src/frontend/App.tsx"), "one");
await fs.writeFile(path.join(root, "src/server/app.ts"), "one");
const before = await fingerprintWorkstreamsApp(root);
await fs.writeFile(path.join(root, "src/frontend/App.tsx"), "two");
assert.equal(await fingerprintWorkstreamsApp(root), before);
await fs.mkdir(path.join(root, "node_modules", ".vite"), { recursive: true });
await fs.mkdir(path.join(root, ".cache"), { recursive: true });
await fs.mkdir(path.join(root, ".tap"), { recursive: true });
await fs.writeFile(path.join(root, "node_modules", ".vite", "metadata.json"), "generated");
await fs.writeFile(path.join(root, ".cache", "generated.json"), "generated");
await fs.writeFile(path.join(root, ".tap", "results.json"), "generated");
assert.equal(await fingerprintWorkstreamsApp(root), before);
await fs.writeFile(path.join(root, "src/server/app.ts"), "two");
assert.notEqual(await fingerprintWorkstreamsApp(root), before);

assert.equal(shouldRestartWorkstreamsBackend("src/frontend/styles.css"), false);
assert.equal(shouldRestartWorkstreamsBackend("src/shared/workstreams.ts"), true);
assert.equal(shouldRestartWorkstreamsBackend("package.json"), true);
assert.equal(shouldRestartWorkstreamsBackend("test/server.doctest.md"), false);
assert.equal(shouldRestartWorkstreamsBackend("dist/frontend/index.html"), false);
assert.equal(shouldRestartWorkstreamsBackend("node_modules/.modules.yaml"), false);
assert.equal(shouldRestartWorkstreamsBackend("node_modules/.vite/deps/_metadata.json"), false);
assert.equal(shouldRestartWorkstreamsBackend(".tap/test-results/results.json"), false);
assert.equal(shouldRestartWorkstreamsBackend(".cache/generated.json"), false);
await fs.rm(root, { recursive: true, force: true });
```

## The exhibits port is never a connection refusal

The exhibits surface is a second listener in the same process group, on its own
origin, and the router does not proxy it — so the router's `/workstreams/*`
fallback cannot help a direct exhibit URL. The supervisor holds the port itself
whenever no child owns it, and hands it back before spawning the replacement.
The child receives the port and the persisted token; Vite never learns the
token.

```ts
const exhibits = makeEffects();
const exhibitsSupervisor = createWorkstreamsAppSupervisor(exhibits.effects, {
  appRoot: "/tmp/fake-workstreams-app",
  logPath: "/tmp/fake-workstreams-app.log",
  log: () => {},
  quietMs: 10,
  activeJobPollMs: 20,
  reconcileMs: 30,
});
await exhibitsSupervisor.start();

assert.deepEqual(exhibits.exhibitsEvents, [`hold:${String(EXHIBITS_DEFAULT_PORT)}`, "release"]);
assert.equal(exhibits.exhibitsFallback(), null);
assert.equal(exhibits.spawnOptions[0]?.exhibitsPort, EXHIBITS_DEFAULT_PORT);
assert.equal(exhibits.spawnOptions[0]?.exhibitsToken, "exhibits-token-abcdefghijklmnop");
```

A failed child puts the fallback back on the port, and the page reports the
state, the failure, and the log to read — without depending on the app package
that just failed to start. The surviving sibling is stopped *first*: it may
still own the exhibits port, and a fallback that binds ahead of that gets
EADDRINUSE, leaving the developer with no child and no fallback.

```ts continue
exhibits.children.at(-1)!.fire({ code: 9, signal: null });
await exhibits.settle();
assert.deepEqual(exhibits.exhibitsEvents.slice(2), ["stop", `hold:${String(EXHIBITS_DEFAULT_PORT)}`]);

const page = exhibits.exhibitsFallback() ?? "";
assert.match(page, /Exhibits unavailable/);
assert.match(page, /frontend exited unexpectedly \(code 9\)/);
assert.match(page, /fake-workstreams-app\.log/);
assert.match(page, /files in the store and are unaffected/);
```

A retry releases the port to the replacement child before it is spawned, so the
new listener can bind it.

```ts continue
await exhibitsSupervisor.retry();
assert.equal(exhibitsSupervisor.state().phase, "ready");
// The fallback is already bound from the failure, so the retry only releases.
assert.deepEqual(exhibits.exhibitsEvents.slice(4), ["release"]);
assert.equal(exhibits.exhibitsFallback(), null);

await exhibitsSupervisor.shutdown();
assert.equal(exhibits.exhibitsFallback(), null);
```

A socket can outlive the process that owned it, so one refused bind is not the
end of the fallback: the supervisor retries, and the page appears once the port
is actually free. Without the retry the failure is permanent — nothing else ever
tries to bind that port again.

```ts
const racing = makeEffects();
const racingSupervisor = createWorkstreamsAppSupervisor(racing.effects, {
  appRoot: "/tmp/fake-workstreams-app",
  logPath: "/tmp/fake-workstreams-app.log",
  log: () => {},
  quietMs: 10,
  activeJobPollMs: 20,
  reconcileMs: 30,
  exhibitsHoldRetryMs: 7,
});
await racingSupervisor.start();

racing.setHoldFailures(1);
racing.children.at(-1)!.fire({ code: 9, signal: null });
await racing.settle();
assert.deepEqual(racing.exhibitsEvents.slice(2), ["stop", "hold-failed"]);
assert.equal(racing.exhibitsFallback(), null);

await racing.fireTimer(7);
await racing.settle();
assert.deepEqual(racing.exhibitsEvents.slice(2), ["stop", "hold-failed", `hold:${String(EXHIBITS_DEFAULT_PORT)}`]);
assert.match(racing.exhibitsFallback() ?? "", /Exhibits unavailable/);

await racingSupervisor.shutdown();
```
