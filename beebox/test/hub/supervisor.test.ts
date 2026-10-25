// # Supervisor: child env allowlist, and the readiness-timeout/exit restart race (Track D, chunk D1)
//
// Two `src/hub/supervisor/core.ts` behaviors, both found by cross-model review:
//
// 1. `buildChildEnv` must ALLOWLIST what a hub-spawned box child inherits from
//    the hub's own env, not spread `process.env` wholesale -- `BBX_SESSION_SECRET`
//    is a hub-only credential (see `supervisor.ts`'s `CHILD_ENV_ALLOWLIST` doc
//    comment for why: it's symmetric, so any box that could verify a cookie
//    could also forge one for a sibling box) and must never reach a child.
//    Connector credentials do not pass either: a box's connectors resolve them
//    from the machine secret store under the box's own grants, so what a child
//    inherits is the store's PATH (`BBX_SECRETS_FILE`), not the keys. That
//    includes `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, which
//    configure the fleet LOGIN surface -- and a hub-spawned child is in hub mode,
//    where `/auth/*` is a 404 and login lives at the hub.
// 2. When `launch()`'s readiness timeout fires and it kills the still-starting
//    child itself, that kill's own eventual "exit" event must NOT ALSO be
//    treated as an unexpected crash -- otherwise one failure gets counted (and
//    restarted) twice, and two children end up running for one box slot.

import { test } from "tap";
import { any, eventually, isoDate, uuid } from "@ianbicking/tap-check/check";
import "@ianbicking/tap-check/tap";
import { buildChildEnv, Supervisor } from "../../src/hub/supervisor/core.js";
import { makeFakeChild, type FakeChild } from "./support/fake-child.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { acquireBoxWork, boxMaintenanceStatus } from "../../src/lib/box-maintenance/admission.js";

const validEntry = {
  id: "sch_1",
  label: "rice timer",
  alarm: true,
  announce: "check the rice",
  content: "Ask about the rice",
  createdAt: "2026-07-11T10:00:00.000Z",
  firesAt: "2026-07-11T12:00:00.000Z",
};

// ## `buildChildEnv` allowlists, never spreads
void test("`buildChildEnv` allowlists, never spreads", async (t) => {
  const sourceEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/beebox",
    NODE_ENV: "production",
    BBX_DEV_SURFACES: "1",
    PUBLIC_URL: "https://bbx.example.org",
    BBX_AUTH_FILE: "/home/beebox/.bbx-auth.json",
    BBX_DIAG_API_KEY: "diag-key-value",
    BBX_GOOGLE_TOKENS_FILE: "/home/beebox/.google-tokens.json",
    BBX_SECRETS_FILE: "/home/beebox/.config/beebox/secrets.json",
    // Connector credentials, all withheld: the child resolves these from the
    // store instead, and the login pair configures a surface a hub-mode child
    // does not serve.
    THINKING_OPENAI_API_KEY: "sk-thinking-value",
    GOOGLE_OAUTH_CLIENT_ID: "app-oauth-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "app-oauth-client-secret",
    BBX_DEEPGRAM_API_KEY: "dg-api-key-value",
    BBX_DEEPGRAM_PROJECT: "dg-project-value",
    GEMINI_KEY: "gemini-key-value",
    // Hub-only credential -- must NEVER reach a child.
    BBX_SESSION_SECRET: "hub-only-session-secret",
    // Not on the allowlist at all -- an arbitrary var from the hub's shell.
    SOME_UNRELATED_VAR: "should-not-leak",
    // Was never on the list; kept as one more unlisted name.
    BBX_DEEPGRAM: "not-actually-prefixed",
  };

  const env = buildChildEnv({ sourceEnv, hubExtras: { BBX_HUB_SECRET: "per-boot-hub-secret" } });

  // Whole-env equality also proves every withheld name (BBX_SESSION_SECRET, NODE_ENV,
  // the connector credentials, unlisted names) is absent.
  t.check(env, {
    PATH: "/usr/bin:/bin",
    HOME: "/home/beebox",
    BBX_DEV_SURFACES: "1",
    PUBLIC_URL: "https://bbx.example.org",
    BBX_AUTH_FILE: "/home/beebox/.bbx-auth.json",
    BBX_DIAG_API_KEY: "diag-key-value",
    BBX_GOOGLE_TOKENS_FILE: "/home/beebox/.google-tokens.json",
    BBX_SECRETS_FILE: "/home/beebox/.config/beebox/secrets.json",
    BBX_HUB_SECRET: "per-boot-hub-secret",
  });

  // A source env with nothing set produces an env containing ONLY the hub
  // extras -- confirms the allowlist filters, it doesn't just fail to strip:

  t.check(buildChildEnv({ sourceEnv: {}, hubExtras: { BBX_HUB_SECRET: "x" } }), {
    BBX_HUB_SECRET: "x",
  });

  // The notification settings a box server sends with pass through: its APNs and
  // VAPID keys (box servers are the sending side), fake mode, and fake mode's old
  // name, `BBX_PUSH_FAKE`, which `notifyFakeMode()` still honors for one release.
  // A child that lost the alias would send for real while the hub was faking.

  const notifyEnv = {
    BBX_NOTIFY_FAKE: "1",
    BBX_PUSH_FAKE: "1",
    BBX_APNS_KEY_PATH: "/home/beebox/apns.p8",
    BBX_APNS_KEY_ID: "KEYID",
    BBX_APNS_TEAM_ID: "TEAMID",
    BBX_APNS_BUNDLE_ID: "org.example.app",
    BBX_VAPID_PUBLIC_KEY: "vapid-public",
    BBX_VAPID_PRIVATE_KEY: "vapid-private",
    BBX_VAPID_SUBJECT: "mailto:boxholder@example.org",
  };
  t.check(Object.keys(buildChildEnv({ sourceEnv: notifyEnv, hubExtras: {} })).toSorted(), [
    "BBX_APNS_BUNDLE_ID",
    "BBX_APNS_KEY_ID",
    "BBX_APNS_KEY_PATH",
    "BBX_APNS_TEAM_ID",
    "BBX_NOTIFY_FAKE",
    "BBX_PUSH_FAKE",
    "BBX_VAPID_PRIVATE_KEY",
    "BBX_VAPID_PUBLIC_KEY",
    "BBX_VAPID_SUBJECT",
  ]);
});

// ## A readiness-timeout kill's own exit event doesn't double-schedule a restart
void test("A readiness-timeout kill's own exit event doesn't double-schedule a restart", async (t) => {
  t.teardown(async () => {
    try {
      await supervisor.stopAll();
      await fixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const fixture = await makeTmpBox({ git: true });
  const children: FakeChild[] = [];
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
    lazy: false,
    idleMs: 300_000,
    keepRecent: 0,
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

  // `startAll()` already ran the whole readiness-timeout catch path once: it
  // recorded the failure, killed the (fake) child, and scheduled exactly one
  // restart.

  const afterTimeout = supervisor.getStatuses()[0];
  t.check({ status: afterTimeout?.status, restarts: afterTimeout?.restarts }, {
    status: "starting",
    restarts: 1,
  });

  // Now simulate the killed child's real exit event finally arriving (what a
  // real `killGroup()` would eventually cause) -- same generation, since the
  // scheduled restart hasn't run yet. Without the fix this double-counts the
  // same failure and schedules a second, overlapping restart.

  children[0]?.fireExit(null, "SIGTERM");
  const afterExit = supervisor.getStatuses()[0];
  t.check({ status: afterExit?.status, restarts: afterExit?.restarts }, {
    status: "starting",
    restarts: 1,
  });
});

// ## A development reload exit restarts cleanly without consuming crash budget
void test("A development reload exit restarts cleanly without consuming crash budget", async (t) => {
  t.teardown(async () => {
    try {
      await reloadSupervisor.stopAll();
      await reloadFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const reloadFixture = await makeTmpBox({ git: true });
  const reloadChildren: FakeChild[] = [];
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
    lazy: false,
    idleMs: 300_000,
    keepRecent: 0,
  };
  let rejectReloadReady = false;
  const reloadSupervisor = new Supervisor({
    config: reloadConfig,
    hubSecret: "test-hub-secret",
    spawnChild: reloadSpawnChild,
    checkReady: () => rejectReloadReady ? Promise.reject(new Error("replacement failed")) : Promise.resolve(),
  });
  await reloadSupervisor.startAll();
  const acceptedReloadWork = await acquireBoxWork(reloadFixture.root, { reason: "test" });
  reloadChildren[0]?.fireMessage({ type: "reload-request" });
  while ((await boxMaintenanceStatus(reloadFixture.root)) === null) await new Promise((resolve) => setImmediate(resolve));
  t.check(reloadChildren.map((child) => child.pid), [905000]);

  await t.checkThrows(async () => (await acquireBoxWork(reloadFixture.root, { reason: "test" })), "BoxMaintenanceError");

  await acceptedReloadWork.release();
  while (reloadChildren.length < 2 || reloadSupervisor.getStatuses()[0]?.status !== "running" || (await boxMaintenanceStatus(reloadFixture.root)) !== null) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const reloadStatus = reloadSupervisor.getStatuses()[0];
  t.check(reloadStatus, {
    slug: "fixture",
    status: "running",
    pid: 905001,
    port: any(Number).positive(),
    restarts: 1,
    consecutiveFailures: 0,
    lastError: undefined,
    lastStart: { at: isoDate(), spawnMs: any(Number), readyMs: any(Number) },
  });

  await new Promise((resolve) => setImmediate(resolve));
  rejectReloadReady = true;
  reloadChildren[1]?.fireMessage({ type: "reload-request" });

  // When the replacement fails readiness, the box is unhealthy and the controller
  // releases its owner lock. Per `docs/implemented-plans/box-maintenance-no-wedge.md`, a
  // failed reload must not leave the box refusing work: the phase record stays as
  // unfinished maintenance, with no owner, and new work is admitted. Wait for
  // the release itself; the brief window where the owner still holds `exclusive`
  // is not a state to assert on.

  while (reloadSupervisor.getStatuses()[0]?.status !== "unhealthy" || (await boxMaintenanceStatus(reloadFixture.root))?.owner !== null) await new Promise((resolve) => setImmediate(resolve));
  const failedReload = await boxMaintenanceStatus(reloadFixture.root);
  // The record says changes began and did not complete: exclusive, unowned.
  t.check(failedReload, {
    id: uuid(),
    reason: "development reload",
    phase: "exclusive",
    since: isoDate(),
    owner: null,
    step: undefined,
  });

  const afterFailedReload = await acquireBoxWork(reloadFixture.root, { reason: "test" });
  await afterFailedReload.release();
});

// ## Stopping after the reload acknowledgment leaves a stopped box open
//
// The old child has exited cleanly and no successor has performed startup writes.
// A simultaneous hub stop must release maintenance rather than strand the box.
void test("Stopping after the reload acknowledgment leaves a stopped box open", async (t) => {
  t.teardown(async () => {
    try {
      await stopReloadSupervisor.stopAll();
      await stopReloadFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const stopReloadFixture = await makeTmpBox({ git: true });
  const stopReloadChildren: FakeChild[] = [];
  let stopReloadAcknowledged = false;
  const stopReloadSupervisor = new Supervisor({
    config: {
      port: undefined,
      host: undefined,
      boxes: { fixture: { path: stopReloadFixture.root } },
      configPath: stopReloadFixture.path("hub.json"),
      lazy: false,
      idleMs: 300_000,
      keepRecent: 0,
    },
    hubSecret: "test-hub-secret",
    spawnChild: () => {
      const child = makeFakeChild(907000 + stopReloadChildren.length);
      child.reloadNow = () => {
        void stopReloadSupervisor.stopAll().then(() => {
          stopReloadAcknowledged = true;
          child.fireExit(75, null);
        });
      };
      stopReloadChildren.push(child);
      return child;
    },
    checkReady: () => Promise.resolve(),
  });
  await stopReloadSupervisor.startAll();
  stopReloadChildren[0]?.fireMessage({ type: "reload-request" });
  while (!stopReloadAcknowledged) await new Promise((resolve) => setImmediate(resolve));
  // Wait for the reload controller to clear its record. Release removes the
  // phase and then the lock, so a read between the two still sees the phase;
  // only an absent record is the end state. The timeout only bounds a failure:
  // a stop that leaves the box blocked never gets here.
  await eventually(async () => (await boxMaintenanceStatus(stopReloadFixture.root)) === null, {
    label: "reload controller cleared its maintenance record",
    timeoutMs: 30_000,
  });

  t.check(stopReloadSupervisor.getStatuses()[0]?.status, "stopped");

  t.check(stopReloadChildren.map((child) => child.pid), [907000]);

  const afterStopWork = await acquireBoxWork(stopReloadFixture.root, { reason: "test" });
  await afterStopWork.release();
});

// ## Lazy mode: `startAll` spawns nothing, `ensureRunning` cold-starts on first call, idle collection returns it to "stopped"
//
// Boxholder directive (2026-07-04): a `lazy: true` hub gives each box the same
// lazy/idle semantics `workstreams-app/src/router/server/listener.ts` already has for whole worktrees. No real
// process is spawned here either -- `spawnChild`/`checkReady` are faked the
// same way as above, and the idle timer is driven by a tiny `idleMs` so the
// test doesn't wait out a real 5-minute default.
void test("Lazy mode: `startAll` spawns nothing, `ensureRunning` cold-starts on first call, idle collection returns it to stopped", async (t) => {
  t.teardown(async () => {
    try {
      await lazySupervisor.stopAll();
      await lazyFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const lazyFixture = await makeTmpBox({ git: true });
  const lazyChildren: FakeChild[] = [];
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

  // `startAll()` spawned nothing -- the box starts "stopped", not "starting":

  t.check(lazySupervisor.getStatuses()[0]?.status, "stopped");

  t.check(lazyChildren.map((child) => child.pid), []);

  t.check(lazySupervisor.get("fixture"), undefined);

  // `ensureRunning` spawns it and returns the endpoint once ready:

  const endpoint = await lazySupervisor.ensureRunning("fixture");
  t.check(endpoint?.slug, "fixture");

  t.check(lazySupervisor.getStatuses()[0]?.status, "running");

  t.check(lazyChildren.map((child) => child.pid), [910000]);

  // After `idleMs` with no further `ensureRunning` calls, the box is SIGTERM'd
  // and reported "stopped" again -- `getStatuses()`/`/healthz` surface it, and a
  // fresh `ensureRunning` spawns a NEW child (not the same generation):

  // Wait for the real idle timer to fire and stop the box. A fixed 150 ms sleep
  // raced the timer's callback on a loaded host; the timeout only bounds a failure.
  await eventually(() => lazySupervisor.getStatuses()[0]?.status === "stopped", { label: "idle timer stopped the box", timeoutMs: 30_000 });

  t.check(lazySupervisor.get("fixture"), undefined);

  const revived = await lazySupervisor.ensureRunning("fixture");
  t.check(revived?.slug, "fixture");

  t.check(lazyChildren.map((child) => child.pid), [910000, 910001]);

  t.check(lazySupervisor.getStatuses()[0]?.status, "running");

  // An unconfigured slug's `ensureRunning` just resolves `undefined` -- no spawn attempt:

  t.check(await lazySupervisor.ensureRunning("nope"), undefined);

  t.check(lazyChildren.map((child) => child.pid), [910000, 910001]);
});

// ## `keepRecent`: the most-recently-used running box is exempt from idle-stop, and is displaced when another box becomes more recent
//
// Boxholder directive (2026-07-11): with `keepRecent: 1` a lazy hub keeps the
// single most-recently-used box alive instead of idle-stopping it, so a burst of
// use leaves one box warm ("basically free"). The idle-fire decision is exposed
// as `evaluateIdle(slug)` (the real `setTimeout` just calls it) so the test
// drives it deterministically via an injected clock, with a large `idleMs` so no
// real timer fires mid-test.
void test("`keepRecent`: the most-recently-used running box is exempt from idle-stop, and is displaced when another box becomes more recent", async (t) => {
  t.teardown(async () => {
    try {
      await keepSupervisor.stopAll();
      await keepFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const keepFixture = await makeTmpBox({ git: true });
  const keepChildren: FakeChild[] = [];
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

  // Use box `a` (at t=1000), then box `b` (at t=2000): `b` is now the more-recent
  // box, so the keep-set is `[b]`.

  clock = 1000;
  await keepSupervisor.ensureRunning("a");
  clock = 2000;
  await keepSupervisor.ensureRunning("b");
  t.check(keepSupervisor.keepSetSlugs(), [
    "b",
  ]);

  // `a`'s idle timer firing stops it (not in the keep-set); `b`'s firing keeps it
  // alive (most-recently-used) and re-arms:

  t.check(await keepSupervisor.evaluateIdle("a"), "stopped");

  t.check(await keepSupervisor.evaluateIdle("b"), "kept");

  t.check(keepSupervisor.getStatuses().map((s) => ({ slug: s.slug, status: s.status })), [
    {
      slug: "a",
      status: "stopped",
    },
    {
      slug: "b",
      status: "running",
    },
  ]);

  // Now use `a` again (at t=3000): it becomes the most-recent box, displacing `b`
  // from the keep-set. `b`'s next idle evaluation therefore stops it:

  clock = 3000;
  await keepSupervisor.ensureRunning("a");
  t.check(keepSupervisor.keepSetSlugs(), [
    "a",
  ]);

  t.check(await keepSupervisor.evaluateIdle("b"), "stopped");

  t.check(await keepSupervisor.evaluateIdle("a"), "kept");
});

// ## `keepRecent`: recency persists across a hub restart — `startAll` pre-starts the top-`keepRecent` slugs
//
// Activity recorded in one Supervisor is flushed to `hub-state.json` (a sibling
// of the config file) on `stopAll()`; a fresh Supervisor over the same config
// reads it back and its lazy `startAll` pre-starts the top-`keepRecent` boxes by
// persisted recency instead of leaving everything stopped.
void test("`keepRecent`: recency persists across a hub restart — `startAll` pre-starts the top-`keepRecent` slugs", async (t) => {
  t.teardown(async () => {
    try {
      await second.supervisor.stopAll();
      await rtFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const rtFixture = await makeTmpBox({ git: true });
  function makeRtSupervisor() {
    const children: FakeChild[] = [];
    const config = {
      port: undefined,
      host: undefined,
      boxes: { a: { path: rtFixture.root }, b: { path: rtFixture.root } },
      configPath: rtFixture.path("hub.json"),
      lazy: true,
      idleMs: 100000,
      keepRecent: 1,
    };
    let tick = 5000;
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
      now: () => (tick += 1000),
    });
    return { supervisor, children };
  }

  const first = makeRtSupervisor();
  await first.supervisor.startAll();

  // First boot: no persisted state yet, so `startAll` pre-starts nothing:

  t.check(first.supervisor.getStatuses().map((s) => s.status), [
    "stopped",
    "stopped",
  ]);

  // Use `a` then `b` (so `b` is most-recent), then shut down — `stopAll` flushes
  // recency to disk:

  await first.supervisor.ensureRunning("a");
  await first.supervisor.ensureRunning("b");
  await first.supervisor.stopAll();

  // A fresh Supervisor over the same config pre-starts the single most-recent box
  // (`b`) on `startAll`, leaving `a` stopped:

  const second = makeRtSupervisor();
  await second.supervisor.startAll();
  t.check(second.supervisor.getStatuses().map((s) => ({ slug: s.slug, status: s.status })), [
    {
      slug: "a",
      status: "stopped",
    },
    {
      slug: "b",
      status: "running",
    },
  ]);

  t.check(second.children.map((child) => child.pid), [930000]);
});

// ## Chat schedules keep a lazy box running, and pre-start it at boot
//
// Boxholder directive (2026-07-11): a lazy hub must NEVER idle-stop or fail to
// start a box that holds pending chat `<schedule>` timers — they live in the
// box's `bbx serve` process and a missed alarm is unacceptable. `evaluateIdle`
// therefore checks the box's on-disk `chat-schedules.json` (via the same loader
// `bbx serve` re-arms from) and keeps the box alive if it holds any entry, even
// when it's outside the keep-set (`keepRecent: 0`). Once the file empties (the
// last schedule fired), the next idle evaluation stops it normally.
void test("Chat schedules keep a lazy box running, and pre-start it at boot", async (t) => {
  t.teardown(async () => {
    try {
      await schedSupervisor.stopAll();
      await schedFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const schedFixture = await makeTmpBox({ git: true });
  await schedFixture.write(".beebox/chat-schedules.json", JSON.stringify([validEntry]));

  const schedChildren: FakeChild[] = [];
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

  // With `keepRecent: 0` the box is never in the keep-set, so an idle evaluation
  // would normally stop it. But its `chat-schedules.json` holds an entry, so
  // `evaluateIdle` keeps it alive instead — a distinct `kept-schedule` result:

  await schedSupervisor.ensureRunning("rice");
  t.check(schedSupervisor.getStatuses()[0]?.status, "running");

  t.check(schedSupervisor.keepSetSlugs(), []);

  t.check(await schedSupervisor.evaluateIdle("rice"), "kept-schedule");

  t.check(schedSupervisor.getStatuses()[0]?.status, "running");

  // Once the schedule fires and the file empties, the next idle evaluation stops
  // the box normally:

  await schedFixture.write(".beebox/chat-schedules.json", JSON.stringify([]));
  t.check(await schedSupervisor.evaluateIdle("rice"), "stopped");

  t.check(schedSupervisor.getStatuses()[0]?.status, "stopped");
});

// A lazy `startAll` also PRE-STARTS a schedule-holding box at boot — independent
// of `keepRecent` and of any persisted recency — so an overdue or soon-to-fire
// schedule fires on time after a hub restart, without waiting for a request:
void test("chat schedules pre-start a lazy box at boot", async (t) => {
  t.teardown(async () => {
    try {
      await bootSupervisor.stopAll();
      await bootFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  t.teardown(async () => {
    try {
      await idleSupervisor.stopAll();
      await idleFixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const bootFixture = await makeTmpBox({ git: true });
  await bootFixture.write(".beebox/chat-schedules.json", JSON.stringify([validEntry]));

  const bootChildren: FakeChild[] = [];
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

  t.check(bootSupervisor.getStatuses()[0]?.status, "running");

  t.check(bootChildren.map((child) => child.pid), [950000]);

  // A box with no schedule file is left stopped by the same `startAll` (the scan
  // only starts boxes that actually hold pending schedules):

  const idleFixture = await makeTmpBox({ git: true });
  const idleChildren: FakeChild[] = [];
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

  t.check(idleSupervisor.getStatuses()[0]?.status, "stopped");

  t.check(idleChildren.map((child) => child.pid), []);
});
