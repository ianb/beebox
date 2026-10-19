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
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
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

const HOST_443 = "box.tail1234.ts.net:443";

/** A serve config with one root handler proxying to loopback `port` on `hostPort`. */
const frontingServe = (port: number, hostPort: string) => ({
  Web: { [hostPort]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } },
});

/** The exposure-file entries for one loopback port. */
const exposed = (port: number) => loadExposureFile().targets.filter((target) => target.port === port);
const exposureEntry = (port: number) => ({ port, dnsName: "box.tail1234.ts.net", configuredAt: isoDate() });

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
    ["unreachable", "enforced", "ambiguous", "open", "enforced", "ambiguous", "ambiguous", "ambiguous"],
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
  t.check(result, { ok: true, message: "Exposed at https://box.tail1234.ts.net/ (loopback:3210). Serve config + exposure intent recorded." });

  // Serve now fronts loopback:3210 on the node's host:443, with no Funnel key.
  t.check(state.serve, { Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3210" } } } } });

  // The exposure intent was recorded with port + dnsName.
  t.check(exposed(3210), [exposureEntry(3210)]);

  // ## Funnel is NEVER enabled by setup
  //
  // Setup issues no `funnel` command and writes no `AllowFunnel`.
  t.check(sim.calls, ["tailscale status --json", "tailscale serve status --json", "tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3210", "tailscale status --json", "tailscale serve status --json"]);
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
  // The serve write failed, yet intent is recorded (fail closed).
  t.check({ result, calls: sim.calls, exposure: exposed(3230) }, {
    result: { ok: false, message: "`tailscale serve` failed (exit 1): serve write failed" },
    calls: ["tailscale status --json", "tailscale serve status --json", "tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3230"],
    exposure: [
      exposureEntry(3230),
    ],
  });
});

// ## Idempotent: a second run reaches the same state, no duplicate intent
void test("Idempotent: a second run reaches the same state, no duplicate intent", async (t) => {
  // doctest:L258
  const state: SimState = { status: runningStatus, serve: {}, probe: enforced401 };
  const sim = makeServeSim(state);
  await runTailscaleSetup(sim.deps, { target: { port: 3211 }, io: noWaitIo });
  const first = await runTailscaleSetup(sim.deps, { target: { port: 3211 }, io: noWaitIo });
  t.check({ first, exposure: exposed(3211) }, {
    first: { ok: true, message: "Exposed at https://box.tail1234.ts.net/ (loopback:3211). Serve config + exposure intent recorded." },
    exposure: [
      exposureEntry(3211),
    ],
  });
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
  t.check(state.serve, {
    Web: {
      "box.tail1234.ts.net:8443": {
        Handlers: {
          "/": {
            Proxy: "http://127.0.0.1:5000",
          },
        },
      },
      "box.tail1234.ts.net:443": {
        Handlers: {
          "/": {
            Proxy: "http://127.0.0.1:3212",
          },
        },
      },
    },
  });
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
  t.check({ result, calls: sim.calls, exposure: exposed(3220) }, {
    result: { ok: false, message: "REFUSING to expose loopback:3220 — it reports open (UNAUTHENTICATED) mode at http://127.0.0.1:3220/auth/me. Fronting it with Tailscale Serve would hand the whole tailnet an unauthenticated box. Give the server real authentication first." },
    calls: ["tailscale status --json", "tailscale serve status --json"],
    exposure: [],
  });
});

// ## Guard: refuse on an unreachable, ambiguous, generic-401, or random-JSON probe
void test("Guard: refuse on an unreachable, ambiguous, generic-401, or random-JSON probe", async (t) => {
  // doctest:L321
  const unreachable = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
  const r1 = await runTailscaleSetup(unreachable.deps, { target: { port: 3221 }, io: noWaitIo });

  // doctest:L324
  const generic401 = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: true, status: 401, body: "Unauthorized" } });
  const r2 = await runTailscaleSetup(generic401.deps, { target: { port: 3222 }, io: noWaitIo });

  const randomEmail = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: true, status: 200, body: JSON.stringify({ email: "x" }) } });
  const r3 = await runTailscaleSetup(randomEmail.deps, { target: { port: 3223 }, io: noWaitIo });

  t.check([r1, r2, r3], [
    { ok: false, message: "REFUSING to expose loopback:3221 — nothing answered at http://127.0.0.1:3221/auth/me. Start the auth-gated bbx serve/hub on that port first, then re-run `bbx tailscale setup`." },
    { ok: false, message: "REFUSING to expose loopback:3222 — http://127.0.0.1:3222/auth/me did not report a recognizable beebox auth posture (neither a `{error:…}` 401, nor an authenticated-user body, nor open mode). Refusing to assume it is a protected beebox." },
    { ok: false, message: "REFUSING to expose loopback:3223 — http://127.0.0.1:3223/auth/me did not report a recognizable beebox auth posture (neither a `{error:…}` 401, nor an authenticated-user body, nor open mode). Refusing to assume it is a protected beebox." },
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
  t.check({ result, calls: sim.calls }, {
    result: { ok: false, message: "REFUSING to expose loopback:3210 — it answers `/__router/status` 200 with the dev router's own status JSON, which means this router is NOT running the Track-B auth gate (a pre-Track-B build). Update/rebuild the router so its gate denies anonymous access (a guarded router answers `/__router/status` with 401), then re-run `bbx tailscale setup` — a guarded dev router is exposable, an ungated one is not." },
    calls: ["tailscale status --json", "tailscale serve status --json"],
  });
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
  t.check({ result, serve: state.serve, calls: sim.calls, exposure: exposed(3210) }, {
    result: { ok: true, message: "Exposed the guarded dev router at https://box.tail1234.ts.net/ (loopback:3210). Anonymous `/__router/status` over Serve returned 401 — the auth gate is live end-to-end. Serve config + exposure intent recorded." },
    serve: frontingServe(3210, HOST_443),
    calls: ["tailscale status --json", "tailscale serve status --json", "tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3210"],
    exposure: [
      exposureEntry(3210),
    ],
  });
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
  t.check({ result, sleeps: sim.sleeps, exposure: exposed(3272) }, {
    result: { ok: true, message: "Exposed the guarded dev router at https://box.tail1234.ts.net/ (loopback:3272). Anonymous `/__router/status` over Serve returned 401 — the auth gate is live end-to-end. Serve config + exposure intent recorded." },
    sleeps: [
      2000,
      2000,
    ],
    exposure: [
      exposureEntry(3272),
    ],
  });
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
  // Serve WAS configured, then torn down; the reachable-but-wrong answer gets no retry spin.
  t.check({ result, calls: sim.calls, serve: state.serve, sleeps: sim.sleeps, exposure: exposed(3270) }, {
    result: { ok: false, message: "REFUSING to expose loopback:3270 — the served https://box.tail1234.ts.net/__router/status returned 200 WITHOUT the guarded-router 401+header, so anonymous access is NOT proven denied end-to-end over Serve. Tore the serve mapping back down (confirmed removed); no exposure recorded." },
    calls: ["tailscale status --json", "tailscale serve status --json", "tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3270", "tailscale serve --https=443 --set-path=/ off", "tailscale serve status --json"],
    serve: {
      Web: {},
    },
    sleeps: [],
    exposure: [],
  });
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
  // The mapping is STILL live, and the intent is RECORDED so it is tracked.
  t.check({ result, serve: state.serve, exposure: exposed(3271) }, {
    result: { ok: false, message: "REFUSING to expose loopback:3271 — the served https://box.tail1234.ts.net/__router/status returned 200 WITHOUT the guarded-router 401+header, so anonymous access is NOT proven denied over Serve. The serve mapping could NOT be proven torn down (it still fronts the port) — it may still be LIVE fronting a router whose gate is unproven. Recorded exposure intent so it is tracked; remove it NOW with `bbx tailscale stop --target 3271` (or `tailscale serve status`)." },
    serve: frontingServe(3271, HOST_443),
    exposure: [
      exposureEntry(3271),
    ],
  });
});

// ## Track C: setup enables no Funnel for the router either
//
// The guarded-router path issues no `funnel` command and writes no `AllowFunnel`.
void test("The guarded-router path issues no funnel command and writes no AllowFunnel.", async (t) => {
  // doctest:L506
  const state: SimState = { status: runningStatus, serve: {}, routerProbe: guardedRouterProbe };
  const sim = makeServeSim(state);
  await runTailscaleSetup(sim.deps, { target: { port: 3271 }, io: noWaitIo });
  t.check({ calls: sim.calls, serve: state.serve }, {
    calls: ["tailscale status --json", "tailscale serve status --json", "tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3271"],
    serve: frontingServe(3271, HOST_443),
  });
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
  t.check({ result, exposure: exposed(3240) }, {
    result: { ok: false, message: "REFUSING to expose loopback:3240 — this server also answers on 10.0.0.5:3240, so it is bound to a public interface, not 127.0.0.1 only. Bind it to loopback before exposing it over Tailscale (a non-loopback bind is already reachable without Serve)." },
    exposure: [],
  });
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
  t.check({ result, logged }, {
    result: { ok: false, message: "Not done yet — do the step above, then re-run `bbx tailscale setup`." },
    logged: ["Next: Interactive: run `tailscale up`. Headless: run `tailscale up --auth-key=<key>` with a single-use key from the admin console.", "Docs: https://tailscale.com/kb/1085/auth-keys"],
  });
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
  t.check(result, { ok: true, message: "Exposed at https://box.tail1234.ts.net/ (loopback:3225). Serve config + exposure intent recorded." });
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
  t.check({ stop, serve: state.serve, exposure: exposed(3226) }, {
    stop: { ok: true, message: "Removed box.tail1234.ts.net:443/ → loopback:3226 and cleared its exposure intent." },
    serve: frontingServe(5000, "box.tail1234.ts.net:8443"),
    exposure: [],
  });
});

// ## F6: stop tears down the target's path only, not a hardcoded `/`
//
// The target is mapped at `/foo` on :443 alongside an UNRELATED `/` handler
// (a different port). Stop removes `/foo` and leaves `/` untouched.
void test("The target is mapped at /foo on :443 alongside an UNRELATED / handler (a diff...", async (t) => {
  // doctest:L610
  const serve: ServeConfigJson = {
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
  // Exactly `/foo` is torn down, not `/`, and the unrelated `/` handler is preserved.
  t.check({ stop, calls: sim.calls, serve }, {
    stop: { ok: true, message: "Removed box.tail1234.ts.net:443/foo → loopback:3250 and cleared its exposure intent." },
    calls: ["tailscale status --json", "tailscale serve status --json", "tailscale serve --https=443 --set-path=/foo off", "tailscale serve status --json"],
    serve: frontingServe(5000, HOST_443),
  });
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
  const serve: ServeConfigJson = {
    Web: {
      "old-name.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3260" } } },
      "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3260" } } },
    },
  };
  const sim = makeServeSim({ status: runningStatus, serve, probe: enforced401 });
  await recordExposure({ port: 3260, dnsName: "box.tail1234.ts.net" });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3260 } });
  // Proof failed (fail closed): the stale host survives, and the guard is KEPT.
  t.check({ stop, calls: sim.calls, serve, exposure: exposed(3260) }, {
    stop: { ok: false, message: "A serve mapping for loopback:3260 is still present after teardown — KEEPING the exposure intent (fail closed). Remove it manually with `tailscale serve status`." },
    calls: ["tailscale status --json", "tailscale serve status --json", "tailscale serve --https=8443 --set-path=/ off", "tailscale serve --https=443 --set-path=/ off", "tailscale serve status --json"],
    serve: frontingServe(3260, "old-name.tail1234.ts.net:8443"),
    exposure: [
      exposureEntry(3260),
    ],
  });
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
  t.check({ stop, exposure: exposed(3260) }, {
    stop: { ok: false, message: "Could not prove the Tailscale serve mapping for loopback:3260 is gone (the `tailscale` CLI is not on PATH). KEEPING the exposure intent for loopback:3260 (fail closed). Re-run `bbx tailscale stop --target 3260` once Tailscale is reachable." },
    exposure: [
      exposureEntry(3260),
    ],
  });
});

// ## Stop when nothing is configured is a clean no-op (exit 0)
void test("Stop when nothing is configured is a clean no-op (exit 0)", async (t) => {
  // doctest:L701
  const sim = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
  const stop = await runTailscaleStop(sim.deps, { target: { port: 3299 } });
  t.check(stop, { ok: true, message: "Nothing configured for loopback:3299 — nothing to stop." });
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
  t.check({ blockedName, blocked: exposed(4001), recorded: exposed(4002) }, {
    blockedName: "LockHeldError",
    blocked: [],
    recorded: [
      {
        port: 4002,
        dnsName: "b.ts.net",
        configuredAt: isoDate(),
      },
    ],
  });
});
