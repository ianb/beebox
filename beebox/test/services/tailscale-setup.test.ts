// # Tailscale setup / stop (guided serve-config loop)
//
// `bbx tailscale setup` runs the status state machine as a guided loop: it proves
// the loopback target is an auth-enforcing beebox (never the router, never a
// non-loopback bind, never open/ambiguous), records exposure intent BEFORE it
// mutates Serve, writes a persistent path-scoped mapping (preserving unrelated
// ones), and re-verifies. `bbx tailscale stop` removes only that target's mapping(s)
// and clears intent ONLY after a readback proves removal. Everything runs against a
// stateful fake modeling `tailscale serve`'s incremental semantics — no tailnet, no
// TTY. See `docs/implemented-plans/tailscale-expose-and-protect.md` Track B chunk 2.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTailscaleSetup, runTailscaleStop } from "../../src/services/tailscale-setup/core.js";
import { classifyAuthPosture } from "../../src/services/tailscale-target.js";
import { loadExposureFile, recordExposure, clearExposure } from "../../src/services/tailscale-setup/exposure.js";
import { acquireLock, releaseLock } from "../../src/lib/file-lock.js";
import type { SetupIo } from "../../src/services/tailscale-setup/core.js";
import type { CommandResult, ProbeResult, ServeConfigJson, TailscaleDeps, TailscaleStatusJson } from "../../src/services/tailscale.js";

// A machine-level exposure file scoped to this test run (record/clear write here).
const EXPOSURE_FILE = path.join(
  os.tmpdir(),
  `bbx-exposure-setup-test-${process.pid}-${Date.now()}.json`,
);
process.env.BBX_TAILSCALE_EXPOSURE_FILE = EXPOSURE_FILE;

// A Running status with tailnet HTTPS certs enabled — the serve/probe precondition.
const runningStatus = {
  BackendState: "Running",
  Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  CertDomains: ["box.tail1234.ts.net"],
};

// The enforced-auth probe shape beebox's `/auth/me` returns unauthenticated.
const enforced401 = { reachable: true, status: 401, body: JSON.stringify({ error: "Not authenticated" }) };

// A guarded dev router's anonymous `/__router/status`: 401 + the self-identifying
// header. An ungated router answers 200 with its status JSON (no header).
const guardedRouterProbe = { reachable: true, status: 401, headers: { "x-bbx-router-guarded": "1" }, body: JSON.stringify({ error: "owner-session-required" }) };
const ungatedRouterProbe = { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, routerPid: 1, worktrees: {} }) };

function cmdOk(stdout: string): CommandResult {
  return { spawned: true, code: 0, stdout, stderr: "" };
}

const notSpawned: CommandResult = { spawned: false, code: null, stdout: "", stderr: "" };
const setPathOf = (args: string[]) => {
  const a = args.find((x) => x.startsWith("--set-path="));
  return a ? a.slice("--set-path=".length) : "/";
};

// A stateful fake modeling `tailscale serve`'s incremental behavior: `--bg`
// adds/replaces the handler at its `--set-path` on <host>:443 (preserving other
// hosts/paths); `… off` removes only that path. Per-command exit codes
// (`serveStatusCode`, `bgCode`), a url-aware probe (loopback `/auth/me`,
// `/__router/status`, and non-loopback addresses each answer separately), and an
// injected non-loopback address list are all scriptable. An UNMODELED tailscale
// command THROWS — a fake gap must fail loudly, never pass as a no-op exit 0.
interface SimState {
  status: TailscaleStatusJson;
  serve: ServeConfigJson;
  probe?: ProbeResult;
  routerProbe?: ProbeResult;
  servedRouterProbe?: ProbeResult | ProbeResult[];
  externalProbe?: ProbeResult;
  networkAddresses?: string[];
  binaryPresent?: boolean;
  serveStatusCode?: number;
  bgCode?: number;
  offCode?: number;
}

function makeServeSim(state: SimState) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  // `servedRouterProbe` may be a SEQUENCE (array): one ProbeResult per served
  // `/__router/status` call, falling back to the last element when exhausted —
  // models the first-serve cert race (`{reachable:false}` a few times, then the
  // guarded 401). A single value keeps answering the same, as before.
  let servedIdx = 0;
  const nextServed = (): ProbeResult => {
    const sp = state.servedRouterProbe;
    if (Array.isArray(sp)) {
      const v = sp[Math.min(servedIdx, sp.length - 1)];
      servedIdx++;
      return v ?? { reachable: false, status: null };
    }
    return sp ?? state.routerProbe ?? { reachable: false, status: null };
  };
  const hostPort = () => `${(state.status.Self?.DNSName ?? "").replace(/\.$/, "")}:443`;
  const deps: TailscaleDeps = {
    run: (cmd: string, args: string[]) => {
      if (cmd !== "tailscale") throw new Error(`unexpected command: ${cmd}`);
      calls.push([cmd, ...args].join(" "));
      if (state.binaryPresent === false) return Promise.resolve(notSpawned);
      const sub = args.join(" ");
      if (sub === "status --json") return Promise.resolve(cmdOk(JSON.stringify(state.status)));
      if (sub === "serve status --json") {
        return Promise.resolve({ spawned: true, code: state.serveStatusCode ?? 0, stdout: JSON.stringify(state.serve), stderr: "" });
      }
      if (args.includes("--bg")) {
        if ((state.bgCode ?? 0) !== 0) return Promise.resolve({ spawned: true, code: state.bgCode ?? null, stdout: "", stderr: "serve write failed" });
        const hp = hostPort();
        const webHosts = (state.serve.Web ??= {});
        const hostEntry = (webHosts[hp] ??= { Handlers: {} });
        const handlers = (hostEntry.Handlers ??= {});
        handlers[setPathOf(args)] = { Proxy: args[args.length - 1] };
        return Promise.resolve(cmdOk(""));
      }
      if (args[args.length - 1] === "off") {
        // `offCode` models a teardown that ERRORS (nonzero) and leaves the
        // mapping live — the fail-closed case settleRouterExposure must catch.
        if ((state.offCode ?? 0) !== 0) return Promise.resolve({ spawned: true, code: state.offCode ?? null, stdout: "", stderr: "serve off failed" });
        // Like the real CLI, `serve … off` addresses the node's CURRENT
        // hostname (honoring --https=<port>); it cannot remove a mapping
        // stored under a pre-rename hostname.
        const httpsArg = args.find((a) => a.startsWith("--https="));
        const port = httpsArg ? httpsArg.slice("--https=".length) : "443";
        const host = `${(state.status.Self?.DNSName ?? "").replace(/\.$/, "")}:${port}`;
        const web = state.serve.Web?.[host];
        if (web?.Handlers) {
          delete web.Handlers[setPathOf(args)];
          if (Object.keys(web.Handlers).length === 0) delete state.serve.Web?.[host];
        }
        return Promise.resolve(cmdOk(""));
      }
      throw new Error(`unmodeled tailscale command: ${sub}`);
    },
    probe: (url: string) => {
      if (url.includes("/__router/status")) {
        // Loopback `/__router/status` (classification) vs the SERVED tailnet URL
        // (Track C's anonymous-denial proof) can answer differently — a gate that
        // classifies guarded on loopback but is NOT isolated over Serve is exactly
        // the fail-closed case setup must catch. `servedRouterProbe` overrides the
        // served answer; both default to `routerProbe`.
        if (url.includes("127.0.0.1")) return Promise.resolve(state.routerProbe ?? { reachable: false, status: null });
        return Promise.resolve(nextServed());
      }
      // Only the injected non-loopback addresses answer as "external"; the served
      // tailnet https URL and loopback /auth/me both model the box (state.probe).
      for (const addr of state.networkAddresses ?? []) {
        if (url.includes(addr)) return Promise.resolve(state.externalProbe ?? { reachable: false, status: null });
      }
      return Promise.resolve(state.probe ?? { reachable: false, status: null });
    },
    networkInterfaces: () => state.networkAddresses ?? [],
    // Instant sleep; record durations so a test can prove the retry loop did
    // (or did NOT) spin.
    sleep: (ms: number) => { sleeps.push(ms); return Promise.resolve(); },
  };
  return { deps, calls, sleeps };
}

// Non-interactive I/O: `--no-wait`. Never blocks on a prompt.
const noWaitIo: SetupIo = { interactive: false, log: () => {}, waitForContinue: () => Promise.resolve() };

// ## `classifyAuthPosture`: strict match on beebox's `/auth/me` shapes
//
// A `{error:…}` 401 or an authenticated-user body (email + isOwner + boxes) ⇒
// enforced. A generic 401, random JSON with only an `email`, an unparseable body,
// a 503, or `{open:true}` are each refused (open / ambiguous) — a generic proxy or
// unrelated service never passes as a protected beebox.
void test("A {error:…} 401 or an authenticated-user body (email + isOwner + boxes) ⇒ enf...", async (t) => {
  // doctest:L170
  t.check(
    [
      classifyAuthPosture({ reachable: false, status: null }),
      classifyAuthPosture(enforced401),
      classifyAuthPosture({ reachable: true, status: 401, body: "Unauthorized" }),
      classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ open: true }) }),
      classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ email: "a@b.c", isOwner: true, boxes: [] }) }),
      classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ email: "a@b.c" }) }),
      classifyAuthPosture({ reachable: true, status: 200, body: "not json" }),
      classifyAuthPosture({ reachable: true, status: 503, body: "" }),
    ],
    [
    "unreachable",
    "enforced",
    "ambiguous",
    "open",
    "enforced",
    "ambiguous",
    "ambiguous",
    "ambiguous",
  ],
  );
});

// ## Setup happy path: probe → configure → re-verify → record intent
//
// Serve unconfigured, auth enforced: setup configures serve, re-verifies to
// `ready`, records the exposure entry, and reports the working URL.
void test("Serve unconfigured, auth enforced:", async (t) => {
  // doctest:L198
  const state: SimState = { status: runningStatus, serve: {}, probe: enforced401 };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3210 }, io: noWaitIo });
  t.check(
    [result.ok, result.message.includes("https://box.tail1234.ts.net/")]
    ,
    [
    true,
    true,
  ],
  );

  // doctest:L209
  t.check(
    // Serve now fronts loopback:3210 on the node's host:443.
    state.serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy,
    "http://127.0.0.1:3210",
  );

  // doctest:L213
  // The exposure intent was recorded with port + dnsName.
  const entry = loadExposureFile().targets.find((target) => target.port === 3210);
  t.check([entry?.port, entry?.dnsName], [
    3210,
    "box.tail1234.ts.net",
  ]);

  // ## Funnel is NEVER enabled by setup
  //
  // Setup issues no `funnel` command and writes no `AllowFunnel`.

  // doctest:L227
  await t.checkText(sim.calls.some((c) => c.includes("funnel")), "false");

  // doctest:L230
  await t.checkText(JSON.stringify(state.serve).includes("Funnel"), "false");
});

// ## F1: intent is recorded BEFORE the serve write (survives a mid-write failure)
//
// If the `tailscale serve` write fails AFTER intent is recorded, the intent STAYS
// (over-recording is the fail-closed direction — the startup guard/stop heals it).
void test("If the tailscale serve write fails AFTER intent is recorded, the intent STAYS...", async (t) => {
  // doctest:L240
  const state: SimState = { status: runningStatus, serve: {}, probe: enforced401, bgCode: 1 };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3230 }, io: noWaitIo });
  t.check(
    [
      result.ok,                                              // the serve write failed
      sim.calls.some((c) => c.includes("--bg")),             // it WAS attempted
      loadExposureFile().targets.some((target) => target.port === 3230), // yet intent is recorded (fail closed)
    ],
    [
    false,
    true,
    true,
  ],
  );
});

// ## Idempotent: a second run reaches the same state, no duplicate intent
void test("Idempotent: a second run reaches the same state, no duplicate intent", async (t) => {
  // doctest:L258
  const state: SimState = { status: runningStatus, serve: {}, probe: enforced401 };
  const sim = makeServeSim(state);
  await runTailscaleSetup(sim.deps, { target: { port: 3211 }, io: noWaitIo });
  const first = await runTailscaleSetup(sim.deps, { target: { port: 3211 }, io: noWaitIo });
  t.check([first.ok, loadExposureFile().targets.filter((target) => target.port === 3211).length], [
    true,
    1,
  ]);
});

// ## Preserve unrelated serve mappings
//
// A pre-existing foreign mapping (another service on host:8443) survives setup;
// the new host:443 mapping is added alongside it.
void test("A pre-existing foreign mapping (another service on host:8443) survives setup;...", async (t) => {
  // doctest:L275
  const foreign = {
    Web: { "box.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } } } },
  };
  const state: SimState = { status: runningStatus, serve: foreign, probe: enforced401 };
  const sim = makeServeSim(state);
  await runTailscaleSetup(sim.deps, { target: { port: 3212 }, io: noWaitIo });
  t.check(
    [
      state.serve.Web?.["box.tail1234.ts.net:8443"]?.Handlers?.["/"]?.Proxy,
      state.serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy,
    ],
    [
    "http://127.0.0.1:5000",
    "http://127.0.0.1:3212",
  ],
  );
});

// ## Guard: refuse to expose an OPEN (unauthenticated) box
//
// The loopback `/auth/me` probe reports `{ open: true }` — setup refuses, never
// issues a serve command, and records no intent.
void test("The loopback /auth/me probe reports { open:", async (t) => {
  // doctest:L297
  const state: SimState = {
    status: runningStatus,
    serve: {},
    probe: { reachable: true, status: 200, body: JSON.stringify({ open: true }) },
  };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3220 }, io: noWaitIo });
  t.check(
    [
      result.ok,
      result.message.includes("UNAUTHENTICATED"),
      sim.calls.some((c) => c.includes("--bg")),
      loadExposureFile().targets.some((target) => target.port === 3220),
    ],
    [
    false,
    true,
    false,
    false,
  ],
  );
});

// ## Guard: refuse on an unreachable, ambiguous, generic-401, or random-JSON probe
void test("Guard: refuse on an unreachable, ambiguous, generic-401, or random-JSON probe", async (t) => {
  // doctest:L321
  const unreachable = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
  const r1 = await runTailscaleSetup(unreachable.deps, { target: { port: 3221 }, io: noWaitIo });

  // doctest:L324
  const generic401 = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: true, status: 401, body: "Unauthorized" } });
  const r2 = await runTailscaleSetup(generic401.deps, { target: { port: 3222 }, io: noWaitIo });

  // doctest:L327
  const randomEmail = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: true, status: 200, body: JSON.stringify({ email: "x" }) } });
  const r3 = await runTailscaleSetup(randomEmail.deps, { target: { port: 3223 }, io: noWaitIo });

  // doctest:L330
  t.check([r1.ok, r1.message.includes("nothing answered"), r2.ok, r3.ok, r2.message.includes("recognizable"), r3.message.includes("recognizable")], [
    false,
    true,
    false,
    false,
    true,
    true,
  ]);
});

// ## Guard: refuse the dev router as a target (router-shape rejection)
//
// If `/__router/status` answers with the dev router's status JSON, setup refuses —
// the router fronts every worktree and is never a valid Tailscale target.
void test("If /router/status answers with the dev router's status JSON, setup refuses —...", async (t) => {
  // doctest:L347
  const state: SimState = {
    status: runningStatus,
    serve: {},
    probe: enforced401,
    routerProbe: { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, routerPid: 1, idleTimeoutMs: 1, worktrees: {} }) },
  };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3210 }, io: noWaitIo });
  t.check([result.ok, result.message.includes("dev router"), sim.calls.some((c) => c.includes("--bg"))], [
    false,
    true,
    false,
  ]);
});

// ## Track C: expose the GUARDED dev router (proof over Serve, then record)
//
// A Track-B-guarded router (loopback `/__router/status` denies anonymously with
// 401 + `x-bbx-router-guarded`) is exposable. Setup configures Serve at `/`, then
// PROVES the denial over the served tailnet path before recording exposure — the
// exposure entry lands ONLY after the served anonymous probe returns 401 + header.
void test("A Track-B-guarded router (loopback /router/status denies anonymously with 401...", async (t) => {
  // doctest:L371
  const state: SimState = { status: runningStatus, serve: {}, routerProbe: guardedRouterProbe };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3210 }, io: noWaitIo });
  t.check(
    [
      result.ok,
      result.message.includes("guarded dev router"),
      state.serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy, // serve fronts the router
      loadExposureFile().targets.some((target) => target.port === 3210),              // exposure recorded (after proof)
    ],
    [
    true,
    true,
    "http://127.0.0.1:3210",
    true,
  ],
  );
});

// ## Track C: first-serve cert race → retry the served probe until guarded → succeed
//
// The FIRST `tailscale serve --https=443` triggers Let's Encrypt cert issuance, so
// the served `/__router/status` is unreachable for a few seconds before the gate
// answers. Setup RETRIES the served probe (sleeping via the injected seam — instant
// here) instead of falsely concluding "never became reachable"; once the guarded
// 401+header lands it records exposure and succeeds.
void test("The FIRST tailscale serve --https=443 triggers Let's Encrypt cert issuance, s...", async (t) => {
  t.teardown(async () => {
    try {
      await clearExposure(3272);
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L397
  const state: SimState = {
    status: runningStatus,
    serve: {},
    routerProbe: guardedRouterProbe, // loopback: guarded → configure Serve
    // served: unreachable twice (cert provisioning), then the guarded 401+header.
    servedRouterProbe: [
      { reachable: false, status: null },
      { reachable: false, status: null },
      guardedRouterProbe,
    ],
  };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3272 }, io: noWaitIo });
  t.check(
    [
      result.ok,
      result.message.includes("guarded dev router"),
      sim.sleeps.length,                                        // retried past 2 unreachable probes
      loadExposureFile().targets.some((target) => target.port === 3272),  // exposure recorded after proof
    ],
    [
    true,
    true,
    2,
    true,
  ],
  );
});

// ## Track C: served anonymous probe returns 200 → tear down, refuse, record nothing
//
// The gate classifies guarded on loopback but is NOT isolated over Serve (the
// served `/__router/status` answers 200, no header) — anonymous access is not
// proven denied end-to-end. Setup tears the just-written mapping back down, refuses,
// and records NO exposure intent (fail closed).
void test("The gate classifies guarded on loopback but is NOT isolated over Serve (the s...", async (t) => {
  // doctest:L436
  const state: SimState = {
    status: runningStatus,
    serve: {},
    routerProbe: guardedRouterProbe,            // loopback: guarded → classify router-guarded, configure Serve
    servedRouterProbe: ungatedRouterProbe,      // served: 200, no header → proof FAILS
  };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3270 }, io: noWaitIo });
  t.check(
    [
      result.ok,
      result.message.includes("NOT proven denied"),
      sim.calls.some((c) => c.includes("--bg")),                             // Serve WAS configured
      sim.calls.includes("tailscale serve --https=443 --set-path=/ off"),    // then torn down
      state.serve.Web?.["box.tail1234.ts.net:443"] ?? null,                  // mapping gone
      loadExposureFile().targets.some((target) => target.port === 3270),               // NO exposure recorded
      sim.sleeps.length,                                                     // reachable-but-wrong: NO retry spin
    ],
    [
    false,
    true,
    true,
    true,
    null,
    false,
    0,
  ],
  );
});

// ## Track C: proof fails AND teardown fails → record intent + loud failure (fail closed)
//
// The served proof fails (200, no header) and the `serve … off` teardown itself
// errors, so the mapping may still be LIVE fronting an unproven router. Setup must
// NOT silently orphan it: it records exposure intent (so `stop`/`status` can find
// and remove it) and returns a loud failure — the fail-closed direction.
void test("The served proof fails (200, no header) and the serve … off teardown itself e...", async (t) => {
  t.teardown(async () => {
    try {
      await clearExposure(3271);
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L472
  const state: SimState = {
    status: runningStatus,
    serve: {},
    routerProbe: guardedRouterProbe,       // loopback: guarded → configure Serve
    servedRouterProbe: ungatedRouterProbe, // served: 200 → proof FAILS
    offCode: 1,                            // teardown errors → mapping survives
  };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3271 }, io: noWaitIo });
  t.check(
    [
      result.ok,
      result.message.includes("could NOT be proven torn down"),
      result.message.includes("bbx tailscale stop --target 3271"),
      state.serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy ?? null, // mapping STILL live
      loadExposureFile().targets.some((target) => target.port === 3271),                       // intent RECORDED (tracked)
    ],
    [
    false,
    true,
    true,
    "http://127.0.0.1:3271",
    true,
  ],
  );
});

// ## Track C: setup enables no Funnel for the router either
//
// The guarded-router path issues no `funnel` command and writes no `AllowFunnel`.
void test("The guarded-router path issues no funnel command and writes no AllowFunnel.", async (t) => {
  // doctest:L506
  const state: SimState = { status: runningStatus, serve: {}, routerProbe: guardedRouterProbe };
  const sim = makeServeSim(state);
  await runTailscaleSetup(sim.deps, { target: { port: 3271 }, io: noWaitIo });
  t.check([sim.calls.some((c) => c.includes("funnel")), JSON.stringify(state.serve).includes("Funnel")], [
    false,
    false,
  ]);
});

// ## Guard: refuse a server that also answers on a non-loopback interface
//
// The same port answers on `10.0.0.5` — the server is bound to a public interface,
// not 127.0.0.1 only. Refuse before exposing it further.
void test("The same port answers on 10.0.0.5 — the server is bound to a public interface...", async (t) => {
  // doctest:L522
  const state: SimState = {
    status: runningStatus,
    serve: {},
    probe: enforced401,
    networkAddresses: ["10.0.0.5"],
    externalProbe: { reachable: true, status: 401, body: JSON.stringify({ error: "x" }) },
  };
  const sim = makeServeSim(state);
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3240 }, io: noWaitIo });
  t.check([result.ok, result.message.includes("10.0.0.5"), loadExposureFile().targets.some((target) => target.port === 3240)], [
    false,
    true,
    false,
  ]);
});

// ## `--no-wait` at a human-action state: print and exit nonzero
//
// At `needs-login` (a human step) with `--no-wait`, setup prints the instruction
// and returns a failing result rather than waiting.
void test("At needs-login (a human step) with --no-wait, setup prints the instruction an...", async (t) => {
  // doctest:L545
  const logged: string[] = [];
  const io: SetupIo = { interactive: false, log: (l) => { logged.push(l); }, waitForContinue: () => Promise.resolve() };
  const sim = makeServeSim({ status: { BackendState: "NeedsLogin", Self: null, CertDomains: null }, serve: {}, probe: { reachable: false, status: null } });
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3224 }, io });
  t.check([result.ok, logged.some((l) => l.startsWith("Next:")), result.message.includes("re-run")], [
    false,
    true,
    true,
  ]);
});

// ## Interactive wait: do the human step, loop advances to the URL
//
// With a TTY, setup waits at `needs-login`; when the operator completes the step
// (here the fake flips the backend to `Running`), the loop advances to success.
void test("With a TTY, setup waits at needs-login; when the operator completes the step...", async (t) => {
  // doctest:L563
  const state: SimState = { status: { BackendState: "NeedsLogin", Self: null, CertDomains: null }, serve: {}, probe: enforced401 };
  const sim = makeServeSim(state);
  const io: SetupIo = {
    interactive: true,
    log: () => {},
    waitForContinue: () => { state.status = runningStatus; return Promise.resolve(); },
  };
  const result = await runTailscaleSetup(sim.deps, { target: { port: 3225 }, io });
  t.check(
    [result.ok, result.message.includes("https://box.tail1234.ts.net/")]
    ,
    [
    true,
    true,
  ],
  );
});

// ## Stop: remove only this target's mapping, preserve others, clear intent
//
// Set up two mappings (foreign on :8443, ours on :443 via setup), then stop ours.
void test("Set up two mappings (foreign on :8443, ours on :443 via setup), then stop ours.", async (t) => {
  // doctest:L583
  const foreign = {
    Web: { "box.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } } } },
  };
  const state: SimState = { status: runningStatus, serve: foreign, probe: enforced401 };
  const sim = makeServeSim(state);
  await runTailscaleSetup(sim.deps, { target: { port: 3226 }, io: noWaitIo });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3226 } });
  await t.checkText(
    [
      stop.ok,
      state.serve.Web?.["box.tail1234.ts.net:443"], // our mapping gone
      state.serve.Web?.["box.tail1234.ts.net:8443"]?.Handlers?.["/"]?.Proxy, // foreign preserved
      loadExposureFile().targets.some((target) => target.port === 3226), // intent cleared
    ],
    `[
  true,
  null,
  "http://127.0.0.1:5000",
  false
]`,
  );
});

// ## F6: stop tears down the target's path only, not a hardcoded `/`
//
// The target is mapped at `/foo` on :443 alongside an UNRELATED `/` handler
// (a different port). Stop removes `/foo` and leaves `/` untouched.
void test("The target is mapped at /foo on :443 alongside an UNRELATED / handler (a diff...", async (t) => {
  // doctest:L610
  const serve = {
    Web: {
      "box.tail1234.ts.net:443": {
        Handlers: {
          "/": { Proxy: "http://127.0.0.1:5000" },
          "/foo": { Proxy: "http://127.0.0.1:3250" },
        },
      },
    },
  };
  const sim = makeServeSim({ status: runningStatus, serve, probe: enforced401 });
  await recordExposure({ port: 3250, dnsName: "box.tail1234.ts.net" });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3250 } });
  t.check(
    [
      stop.ok,
      sim.calls.includes("tailscale serve --https=443 --set-path=/foo off"), // exactly /foo
      sim.calls.includes("tailscale serve --https=443 --set-path=/ off"),    // NOT /
      serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy,         // / preserved
      Object.keys(serve.Web?.["box.tail1234.ts.net:443"]?.Handlers ?? {}).join(","), // only / remains
    ],
    [
    true,
    true,
    false,
    "http://127.0.0.1:5000",
    "/",
  ],
  );
});

// ## Stop scans EVERY host: a pre-rename mapping keeps the guard armed
//
// A mapping created before a node rename lives under the OLD hostname (here also
// a non-443 serve port) and still fronts the target. Stop finds it by scanning
// every Web host for the loopback port — but the real CLI's `serve … off` only
// addresses the current hostname, so the stale mapping survives the readback.
// The proof therefore FAILS: intent is kept and stop reports the survivor.
// (Without the every-host scan, stop would clear the guard while that mapping
// stays live — the fail-open shape of findings 1-2.)
void test("A mapping created before a node rename lives under the OLD hostname (here als...", async (t) => {
  t.teardown(async () => {
    try {
      await clearExposure(3260);
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L650
  const serve = {
    Web: {
      "old-name.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3260" } } },
      "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3260" } } },
    },
  };
  const sim = makeServeSim({ status: runningStatus, serve, probe: enforced401 });
  await recordExposure({ port: 3260, dnsName: "box.tail1234.ts.net" });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3260 } });
  t.check(
    [
      stop.ok,                                                              // proof failed: fail closed
      stop.message.includes("still present"),
      sim.calls.includes("tailscale serve --https=8443 --set-path=/ off"), // teardown attempted old mapping
      sim.calls.includes("tailscale serve --https=443 --set-path=/ off"),  // current mapping torn down
      Object.keys(serve.Web ?? {}).join(","),                               // stale host survives
      loadExposureFile().targets.some((target) => target.port === 3260),              // guard KEPT
    ],
    [
    false,
    true,
    true,
    true,
    "old-name.tail1234.ts.net:8443",
    true,
  ],
  );
});

// ## F2: stop KEEPS the intent when removal can't be proven (tailscale absent)
//
// Intent is recorded, then `tailscale` is unavailable — stop cannot prove the
// mapping is gone, so it keeps the intent (fail closed) and exits nonzero.
void test("Intent is recorded, then tailscale is unavailable — stop cannot prove the map...", async (t) => {
  // doctest:L687
  await recordExposure({ port: 3260, dnsName: "box.tail1234.ts.net" });
  const sim = makeServeSim({ status: runningStatus, serve: {}, probe: enforced401, binaryPresent: false });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3260 } });
  t.check([stop.ok, stop.message.includes("KEEPING"), loadExposureFile().targets.some((target) => target.port === 3260)], [
    false,
    true,
    true,
  ]);
});

// ## Stop when nothing is configured is a clean no-op (exit 0)
void test("Stop when nothing is configured is a clean no-op (exit 0)", async (t) => {
  // doctest:L701
  const sim = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3299 } });
  t.check([stop.ok, stop.message.includes("nothing to stop")], [
    true,
    true,
  ]);
});

// ## F7: the exposure RMW takes the project file lock (cross-process mutual exclusion)
//
// While another process holds the exposure lock, `recordExposure` refuses (fail
// closed — it can't interleave its read-modify-write and lose an entry); once the
// lock is released the write succeeds.
void test("While another process holds the exposure lock, recordExposure refuses (fail c...", async (t) => {
  t.teardown(async () => {
    try {
      fs.rmSync(EXPOSURE_FILE, { force: true });
      fs.rmSync(`${EXPOSURE_FILE}.lock`, { force: true });
      delete process.env.BBX_TAILSCALE_EXPOSURE_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L717
  const lockPath = `${EXPOSURE_FILE}.lock`;
  await acquireLock(lockPath, { op: "other-process" });
  let blockedName = "";
  try {
    await recordExposure({ port: 4001, dnsName: "a.ts.net" });
  } catch (e) {
    blockedName = e instanceof Error ? e.name : String(e);
  }
  await releaseLock(lockPath);
  await recordExposure({ port: 4002, dnsName: "b.ts.net" });
  t.check([blockedName, loadExposureFile().targets.some((target) => target.port === 4001), loadExposureFile().targets.some((target) => target.port === 4002)], [
    "LockHeldError",
    false,
    true,
  ]);
});
