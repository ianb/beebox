# Supervisor: child env allowlist, and the readiness-timeout/exit restart race (Track D, chunk D1)

Two `src/hub/supervisor.ts` behaviors, both found by cross-model review:

1. `buildChildEnv` must ALLOWLIST what a hub-spawned box child inherits from
   the hub's own env, not spread `process.env` wholesale -- `BBX_SESSION_SECRET`
   is a hub-only credential (see `supervisor.ts`'s `CHILD_ENV_ALLOWLIST` doc
   comment for why: it's symmetric, so any box that could verify a cookie
   could also forge one for a sibling box) and must never reach a child.
   `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, by contrast, DO pass
   through: they're the app's connector identity, not a hub secret, and every
   box's Google connectors read them directly to run/refresh their own
   per-box tokens (connector OAuth stays per-box under the current
   architecture -- the box owns its tokens).
2. When `launch()`'s readiness timeout fires and it kills the still-starting
   child itself, that kill's own eventual "exit" event must NOT ALSO be
   treated as an unexpected crash -- otherwise one failure gets counted (and
   restarted) twice, and two children end up running for one box slot.

```ts setup
import { buildChildEnv, Supervisor } from "../../src/hub/supervisor.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** A fake `ChildProc`: just enough surface for `Supervisor.launch()` to use
 *  (`pid`, `on("exit", ...)`, `catch()`) plus a way for the test to fire the
 *  "exit" event itself, standing in for the real process death that a real
 *  `killGroup()` would eventually cause. No real process is ever spawned. */
function makeFakeChild(pid) {
  const exitHandlers = [];
  return {
    pid,
    on(event, bbx) {
      if (event === "exit") exitHandlers.push(bbx);
    },
    catch() {},
    fireExit(code, signal) {
      for (const bbx of exitHandlers) bbx(code, signal);
    },
  };
}

/** Await the supervisor's real readiness transition; the file timeout catches hangs. */
async function awaitRunning(supervisor: Supervisor): Promise<void> {
  while (supervisor.getStatuses()[0]?.status !== "running") {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}
```

## `buildChildEnv` allowlists, never spreads

```ts
const sourceEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/beebox",
  NODE_ENV: "production",
  BBX_DEV_SURFACES: "1",
  PUBLIC_URL: "https://bbx.example.org",
  BBX_AUTH_FILE: "/home/beebox/.bbx-auth.json",
  BBX_DIAG_API_KEY: "diag-key-value",
  BBX_GOOGLE_TOKENS_FILE: "/home/beebox/.google-tokens.json",
  THINKING_OPENAI_API_KEY: "sk-thinking-value",
  // Box-legitimate connector identity -- DOES pass through (shared per-box
  // by design; see block comment above and in supervisor.ts).
  GOOGLE_OAUTH_CLIENT_ID: "app-oauth-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "app-oauth-client-secret",
  // Box-legitimate transcription/image-description keys a `bbx serve` child
  // reads directly -- BBX_DEEPGRAM_* is a PREFIX (covers both
  // API_KEY and PROJECT suffixes), GEMINI_KEY is an exact name.
  BBX_DEEPGRAM_API_KEY: "dg-api-key-value",
  BBX_DEEPGRAM_PROJECT: "dg-project-value",
  GEMINI_KEY: "gemini-key-value",
  // Hub-only credential -- must NEVER reach a child.
  BBX_SESSION_SECRET: "hub-only-session-secret",
  // Not on the allowlist at all -- an arbitrary var from the hub's shell.
  SOME_UNRELATED_VAR: "should-not-leak",
  // Looks like the Deepgram prefix but isn't it -- must not leak by accident.
  BBX_DEEPGRAM: "not-actually-prefixed",
};

const env = buildChildEnv({ sourceEnv, hubExtras: { BBX_HUB_SECRET: "per-boot-hub-secret" } });

JSON.stringify({
  path: env.PATH,
  home: env.HOME,
  devSurfaces: env.BBX_DEV_SURFACES,
  publicUrl: env.PUBLIC_URL,
  authFile: env.BBX_AUTH_FILE,
  diagKey: env.BBX_DIAG_API_KEY,
  tokensFile: env.BBX_GOOGLE_TOKENS_FILE,
  thinkingKey: env.THINKING_OPENAI_API_KEY,
  googleClientId: env.GOOGLE_OAUTH_CLIENT_ID,
  googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  deepgramApiKey: env.BBX_DEEPGRAM_API_KEY,
  deepgramProject: env.BBX_DEEPGRAM_PROJECT,
  geminiKey: env.GEMINI_KEY,
  hubSecret: env.BBX_HUB_SECRET,
})
=> {"path":"/usr/bin:/bin","home":"/home/beebox","devSurfaces":"1","publicUrl":"https://bbx.example.org","authFile":"/home/beebox/.bbx-auth.json","diagKey":"diag-key-value","tokensFile":"/home/beebox/.google-tokens.json","thinkingKey":"sk-thinking-value","googleClientId":"app-oauth-client-id","googleClientSecret":"app-oauth-client-secret","deepgramApiKey":"dg-api-key-value","deepgramProject":"dg-project-value","geminiKey":"gemini-key-value","hubSecret":"per-boot-hub-secret"}
```

```ts continue
"BBX_SESSION_SECRET" in env
=> false

"NODE_ENV" in env
=> false

"GOOGLE_OAUTH_CLIENT_ID" in env
=> true

"GOOGLE_OAUTH_CLIENT_SECRET" in env
=> true

"SOME_UNRELATED_VAR" in env
=> false

"BBX_DEEPGRAM" in env
=> false
```

A source env with nothing set produces an env containing ONLY the hub
extras -- confirms the allowlist filters, it doesn't just fail to strip:

```ts continue
JSON.stringify(buildChildEnv({ sourceEnv: {}, hubExtras: { BBX_HUB_SECRET: "x" } }))
=> {"BBX_HUB_SECRET":"x"}
```

## A readiness-timeout kill's own exit event doesn't double-schedule a restart

```ts continue
const fixture = await makeTmpBox();
const children = [];
function spawnChild() {
  const child = makeFakeChild(900000 + children.length);
  children.push(child);
  return child;
}
function checkReady() {
  // Simulates "the child never becomes ready" without a real 30s wait.
  return Promise.reject(new Error("simulated readiness timeout"));
}

const config = {
  port: undefined,
  host: undefined,
  boxes: { fixture: { path: fixture.root } },
  configPath: fixture.path("hub.json"),
};
// A long backoff, because this section is about what the readiness-timeout
// path RECORDS, not about the retry itself. At the production 1s base, the
// scheduled retry fires while the assertions below are still running whenever
// anything here takes a second (a slow `makeTmpBox`, a loaded machine) — it
// relaunches, readiness rejects again, and `restarts` becomes 2 under a test
// that never asked about the second attempt. That is a live timer racing the
// assertions, and it is what made this file flake in the full parallel suite.
const supervisor = new Supervisor({ config, hubSecret: "test-hub-secret", spawnChild, checkReady, baseBackoffMs: 600_000 });
await supervisor.startAll();
```

`startAll()` already ran the whole readiness-timeout catch path once: it
recorded the failure, killed the (fake) child, and scheduled exactly one
restart.

```ts continue
const afterTimeout = supervisor.getStatuses()[0];
JSON.stringify({ status: afterTimeout.status, restarts: afterTimeout.restarts })
=> {"status":"starting","restarts":1}
```

Now simulate the killed child's real exit event finally arriving (what a
real `killGroup()` would eventually cause) -- same generation, since the
scheduled restart hasn't run yet. Without the fix this double-counts the
same failure and schedules a second, overlapping restart.

```ts continue
children[0].fireExit(null, "SIGTERM");
const afterExit = supervisor.getStatuses()[0];
JSON.stringify({ status: afterExit.status, restarts: afterExit.restarts })
=> {"status":"starting","restarts":1}
```

```ts cleanup
await supervisor.stopAll();
await fixture.cleanup();
```

## A development reload exit restarts cleanly without consuming crash budget

```ts continue
const reloadFixture = await makeTmpBox();
const reloadChildren = [];
function reloadSpawnChild() {
  const child = makeFakeChild(905000 + reloadChildren.length);
  reloadChildren.push(child);
  return child;
}
const reloadConfig = {
  port: undefined,
  host: undefined,
  boxes: { fixture: { path: reloadFixture.root } },
  configPath: reloadFixture.path("hub.json"),
};
const reloadSupervisor = new Supervisor({
  config: reloadConfig,
  hubSecret: "test-hub-secret",
  spawnChild: reloadSpawnChild,
  checkReady: () => Promise.resolve(),
});
await reloadSupervisor.startAll();
reloadChildren[0].fireExit(75, null);
await awaitRunning(reloadSupervisor);
const reloadStatus = reloadSupervisor.getStatuses()[0];
JSON.stringify({ status: reloadStatus.status, pid: reloadStatus.pid, restarts: reloadStatus.restarts, failures: reloadStatus.consecutiveFailures })
=> {"status":"running","pid":905001,"restarts":1,"failures":0}
```

```ts cleanup
await reloadSupervisor.stopAll();
await reloadFixture.cleanup();
```

## Lazy mode: `startAll` spawns nothing, `ensureRunning` cold-starts on first call, idle collection returns it to "stopped"

Boxholder directive (2026-07-04): a `lazy: true` hub gives each box the same
lazy/idle semantics `workstreams-app/src/router/router.ts` already has for whole worktrees. No real
process is spawned here either -- `spawnChild`/`checkReady` are faked the
same way as above, and the idle timer is driven by a tiny `idleMs` so the
doctest doesn't wait out a real 5-minute default.

```ts continue
const lazyFixture = await makeTmpBox();
let lazyChildren = [];
function lazySpawnChild() {
  const child = makeFakeChild(910000 + lazyChildren.length);
  lazyChildren.push(child);
  return child;
}
function lazyCheckReady() {
  return Promise.resolve(); // instantly "ready" -- no real HTTP involved
}

const lazyConfig = {
  port: undefined,
  host: undefined,
  boxes: { fixture: { path: lazyFixture.root } },
  configPath: lazyFixture.path("hub.json"),
  lazy: true,
  idleMs: 30,
  keepRecent: 0,
};
const lazySupervisor = new Supervisor({
  config: lazyConfig,
  hubSecret: "test-hub-secret",
  spawnChild: lazySpawnChild,
  checkReady: lazyCheckReady,
});
await lazySupervisor.startAll();
```

`startAll()` spawned nothing -- the box starts "stopped", not "starting":

```ts continue
lazySupervisor.getStatuses()[0].status
=> stopped

lazyChildren.length
=> 0

lazySupervisor.get("fixture")
=> undefined
```

`ensureRunning` spawns it and returns the endpoint once ready:

```ts continue
const endpoint = await lazySupervisor.ensureRunning("fixture");
endpoint.slug
=> fixture

lazySupervisor.getStatuses()[0].status
=> running

lazyChildren.length
=> 1
```

After `idleMs` with no further `ensureRunning` calls, the box is SIGTERM'd
and reported "stopped" again -- `getStatuses()`/`/healthz` surface it, and a
fresh `ensureRunning` spawns a NEW child (not the same generation):

```ts continue
await new Promise((r) => setTimeout(r, 150));
lazySupervisor.getStatuses()[0].status
=> stopped

lazySupervisor.get("fixture")
=> undefined

const revived = await lazySupervisor.ensureRunning("fixture");
revived.slug
=> fixture

lazyChildren.length
=> 2

lazySupervisor.getStatuses()[0].status
=> running
```

An unconfigured slug's `ensureRunning` just resolves `undefined` -- no spawn attempt:

```ts continue
(await lazySupervisor.ensureRunning("nope")) === undefined
=> true

lazyChildren.length
=> 2
```

```ts cleanup
await lazySupervisor.stopAll();
await lazyFixture.cleanup();
```

## `keepRecent`: the most-recently-used running box is exempt from idle-stop, and is displaced when another box becomes more recent

Boxholder directive (2026-07-11): with `keepRecent: 1` a lazy hub keeps the
single most-recently-used box alive instead of idle-stopping it, so a burst of
use leaves one box warm ("basically free"). The idle-fire decision is exposed
as `evaluateIdle(slug)` (the real `setTimeout` just calls it) so the doctest
drives it deterministically via an injected clock, with a large `idleMs` so no
real timer fires mid-test.

```ts continue
const keepFixture = await makeTmpBox();
let keepChildren = [];
function keepSpawnChild() {
  const child = makeFakeChild(920000 + keepChildren.length);
  keepChildren.push(child);
  return child;
}
function keepCheckReady() {
  return Promise.resolve();
}

let clock = 1000;
const keepConfig = {
  port: undefined,
  host: undefined,
  boxes: { a: { path: keepFixture.root }, b: { path: keepFixture.root } },
  configPath: keepFixture.path("hub.json"),
  lazy: true,
  idleMs: 100000,
  keepRecent: 1,
};
const keepSupervisor = new Supervisor({
  config: keepConfig,
  hubSecret: "test-hub-secret",
  spawnChild: keepSpawnChild,
  checkReady: keepCheckReady,
  now: () => clock,
});
await keepSupervisor.startAll();
```

Use box `a` (at t=1000), then box `b` (at t=2000): `b` is now the more-recent
box, so the keep-set is `[b]`.

```ts continue
clock = 1000;
await keepSupervisor.ensureRunning("a");
clock = 2000;
await keepSupervisor.ensureRunning("b");
JSON.stringify(keepSupervisor.keepSetSlugs())
=> ["b"]
```

`a`'s idle timer firing stops it (not in the keep-set); `b`'s firing keeps it
alive (most-recently-used) and re-arms:

```ts continue
await keepSupervisor.evaluateIdle("a")
=> stopped

await keepSupervisor.evaluateIdle("b")
=> kept

JSON.stringify(keepSupervisor.getStatuses().map((s) => ({ slug: s.slug, status: s.status })))
=> [{"slug":"a","status":"stopped"},{"slug":"b","status":"running"}]
```

Now use `a` again (at t=3000): it becomes the most-recent box, displacing `b`
from the keep-set. `b`'s next idle evaluation therefore stops it:

```ts continue
clock = 3000;
await keepSupervisor.ensureRunning("a");
JSON.stringify(keepSupervisor.keepSetSlugs())
=> ["a"]

await keepSupervisor.evaluateIdle("b")
=> stopped

await keepSupervisor.evaluateIdle("a")
=> kept
```

```ts cleanup
await keepSupervisor.stopAll();
await keepFixture.cleanup();
```

## `keepRecent`: recency persists across a hub restart — `startAll` pre-starts the top-`keepRecent` slugs

Activity recorded in one Supervisor is flushed to `hub-state.json` (a sibling
of the config file) on `stopAll()`; a fresh Supervisor over the same config
reads it back and its lazy `startAll` pre-starts the top-`keepRecent` boxes by
persisted recency instead of leaving everything stopped.

```ts continue
const rtFixture = await makeTmpBox();
function makeRtSupervisor() {
  const children = [];
  const config = {
    port: undefined,
    host: undefined,
    boxes: { a: { path: rtFixture.root }, b: { path: rtFixture.root } },
    configPath: rtFixture.path("hub.json"),
    lazy: true,
    idleMs: 100000,
    keepRecent: 1,
  };
  let t = 5000;
  const supervisor = new Supervisor({
    config,
    hubSecret: "test-hub-secret",
    spawnChild() {
      const child = makeFakeChild(930000 + children.length);
      children.push(child);
      return child;
    },
    checkReady() {
      return Promise.resolve();
    },
    now: () => (t += 1000),
  });
  return { supervisor, children };
}

const first = makeRtSupervisor();
await first.supervisor.startAll();
```

First boot: no persisted state yet, so `startAll` pre-starts nothing:

```ts continue
JSON.stringify(first.supervisor.getStatuses().map((s) => s.status))
=> ["stopped","stopped"]
```

Use `a` then `b` (so `b` is most-recent), then shut down — `stopAll` flushes
recency to disk:

```ts continue
await first.supervisor.ensureRunning("a");
await first.supervisor.ensureRunning("b");
await first.supervisor.stopAll();
```

A fresh Supervisor over the same config pre-starts the single most-recent box
(`b`) on `startAll`, leaving `a` stopped:

```ts continue
const second = makeRtSupervisor();
await second.supervisor.startAll();
JSON.stringify(second.supervisor.getStatuses().map((s) => ({ slug: s.slug, status: s.status })))
=> [{"slug":"a","status":"stopped"},{"slug":"b","status":"running"}]

second.children.length
=> 1
```

```ts cleanup
await second.supervisor.stopAll();
await rtFixture.cleanup();
```

## Chat schedules keep a lazy box running, and pre-start it at boot

Boxholder directive (2026-07-11): a lazy hub must NEVER idle-stop or fail to
start a box that holds pending chat `<schedule>` timers — they live in the
box's `bbx serve` process and a missed alarm is unacceptable. `evaluateIdle`
therefore checks the box's on-disk `chat-schedules.json` (via the same loader
`bbx serve` re-arms from) and keeps the box alive if it holds any entry, even
when it's outside the keep-set (`keepRecent: 0`). Once the file empties (the
last schedule fired), the next idle evaluation stops it normally.

```ts continue
const schedFixture = await makeTmpBox();
const validEntry = {
  id: "sch_1",
  label: "rice timer",
  alarm: true,
  announce: "check the rice",
  content: "Ask about the rice",
  createdAt: "2026-07-11T10:00:00.000Z",
  firesAt: "2026-07-11T12:00:00.000Z",
};
await schedFixture.write(".beebox/chat-schedules.json", JSON.stringify([validEntry]));

let schedChildren = [];
const schedSupervisor = new Supervisor({
  config: {
    port: undefined,
    host: undefined,
    boxes: { rice: { path: schedFixture.root } },
    configPath: schedFixture.path("hub.json"),
    lazy: true,
    idleMs: 100000,
    keepRecent: 0,
  },
  hubSecret: "test-hub-secret",
  spawnChild() {
    const child = makeFakeChild(940000 + schedChildren.length);
    schedChildren.push(child);
    return child;
  },
  checkReady() {
    return Promise.resolve();
  },
});
await schedSupervisor.startAll();
```

With `keepRecent: 0` the box is never in the keep-set, so an idle evaluation
would normally stop it. But its `chat-schedules.json` holds an entry, so
`evaluateIdle` keeps it alive instead — a distinct `kept-schedule` result:

```ts continue
await schedSupervisor.ensureRunning("rice");
schedSupervisor.getStatuses()[0].status
=> running

JSON.stringify(schedSupervisor.keepSetSlugs())
=> []

await schedSupervisor.evaluateIdle("rice")
=> kept-schedule

schedSupervisor.getStatuses()[0].status
=> running
```

Once the schedule fires and the file empties, the next idle evaluation stops
the box normally:

```ts continue
await schedFixture.write(".beebox/chat-schedules.json", JSON.stringify([]));
await schedSupervisor.evaluateIdle("rice")
=> stopped

schedSupervisor.getStatuses()[0].status
=> stopped
```

```ts cleanup
await schedSupervisor.stopAll();
await schedFixture.cleanup();
```

A lazy `startAll` also PRE-STARTS a schedule-holding box at boot — independent
of `keepRecent` and of any persisted recency — so an overdue or soon-to-fire
schedule fires on time after a hub restart, without waiting for a request:

```ts continue
const bootFixture = await makeTmpBox();
await bootFixture.write(".beebox/chat-schedules.json", JSON.stringify([validEntry]));

let bootChildren = [];
const bootSupervisor = new Supervisor({
  config: {
    port: undefined,
    host: undefined,
    boxes: { rice: { path: bootFixture.root } },
    configPath: bootFixture.path("hub.json"),
    lazy: true,
    idleMs: 100000,
    keepRecent: 0,
  },
  hubSecret: "test-hub-secret",
  spawnChild() {
    const child = makeFakeChild(950000 + bootChildren.length);
    bootChildren.push(child);
    return child;
  },
  checkReady() {
    return Promise.resolve();
  },
});
await bootSupervisor.startAll();

bootSupervisor.getStatuses()[0].status
=> running

bootChildren.length
=> 1
```

A box with no schedule file is left stopped by the same `startAll` (the scan
only starts boxes that actually hold pending schedules):

```ts continue
const idleFixture = await makeTmpBox();
let idleChildren = [];
const idleSupervisor = new Supervisor({
  config: {
    port: undefined,
    host: undefined,
    boxes: { plain: { path: idleFixture.root } },
    configPath: idleFixture.path("hub.json"),
    lazy: true,
    idleMs: 100000,
    keepRecent: 0,
  },
  hubSecret: "test-hub-secret",
  spawnChild() {
    const child = makeFakeChild(960000 + idleChildren.length);
    idleChildren.push(child);
    return child;
  },
  checkReady() {
    return Promise.resolve();
  },
});
await idleSupervisor.startAll();

idleSupervisor.getStatuses()[0].status
=> stopped

idleChildren.length
=> 0
```

```ts cleanup
await bootSupervisor.stopAll();
await idleSupervisor.stopAll();
await bootFixture.cleanup();
await idleFixture.cleanup();
```
