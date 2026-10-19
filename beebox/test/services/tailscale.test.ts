// # Tailscale status state machine
//
// `bbx tailscale status` is a fail-closed state machine over `tailscale`'s CLI
// output. It runs against injected fake deps (`createFakeTailscaleDeps`) so every
// state is testable with no tailnet. Each fake scripts the two subcommands
// (`tailscale status --json`, `tailscale serve status --json`) plus the `/auth/me`
// probe, and per-command exit codes. See
// `docs/implemented-plans/tailscale-expose-and-protect.md` Track B.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import {
  parseStatusJson,
  parseServeConfig,
  loopbackProxyPort,
  hasFunnelForTarget,
  toBackendState,
  deriveTailscaleBaseUrl,
  type ProbeResult,
  type ServeConfigJson,
  type TailscaleDeps,
} from "../../src/services/tailscale.js";
import { createFakeTailscaleDeps } from "../../src/services/tailscale-fake.js";
import { runTailscaleStatus, reportToJson } from "../../src/services/tailscale-status/core.js";
import { classifyTargetPosture, describeRefusal } from "../../src/services/tailscale-target.js";
import { formatReportHuman } from "../../src/cli/commands/tailscale.js";

// Real `tailscale status --json` emits Self and CertDomains WITHOUT omitempty —
// always present, JSON `null` before the node is up. Model a bare backend state
// that way so the schema's required-key check is exercised realistically.
const bs = (BackendState: string) => ({ BackendState, Self: null, CertDomains: null });

// A Running status with tailnet HTTPS certs enabled — the precondition for the
// serve/probe states. Individual tests override `serve`/`probe`.
const runningStatus = {
  BackendState: "Running",
  Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  CertDomains: ["box.tail1234.ts.net"],
};

// A serve config that correctly fronts loopback:3210.
const correctServe = {
  Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3210" } } } },
};

// A guarded dev router's anonymous `/__router/status` reply: 401 + the
// self-identifying header (its Track-B gate denies unauthenticated access). An
// ungated (pre-Track-B) router answers 200 with its own status JSON, no header.
const guardedRouterProbe = { reachable: true, status: 401, headers: { "x-bbx-router-guarded": "1" }, body: JSON.stringify({ error: "owner-session-required" }) };
const ungatedRouterProbe = { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, routerPid: 1, worktrees: {} }) };

// The two enforced-auth probe shapes beebox's `/auth/me` produces.
const enforced401 = { reachable: true, status: 401, body: JSON.stringify({ error: "Not authenticated" }) };
const authed200 = {
  reachable: true,
  status: 200,
  body: JSON.stringify({ email: "a@b.c", name: "A", isOwner: true, boxes: [] }),
};

// `runTailscaleStatus` receives an already-resolved concrete target (the CLI
// turns `--target`/auto-discovery into a `{ port }` via `resolveTargetOrDiscover`
// — see tailscale-discovery.doctest.md). This helper mirrors that boundary.
// Deps with a correct serve config and the given `/auth/me` probe, or with only
// a status payload.
const withProbe = (probe: ProbeResult) => createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, probe });
const withStatus = (status: unknown) => createFakeTailscaleDeps({ status });
const report = (deps: TailscaleDeps) => runTailscaleStatus(deps, { target: { port: 3210 } });

// ## Every state is its own branch
//
// Each input below scripts the fake `tailscale` CLI and lands in exactly one
// state of the machine. Reading the table top to bottom follows the order the
// machine checks things.
//
// - **cli-error:** a `tailscale` call that spawns but exits nonzero (dead daemon,
//   permission error) is a DISTINCT `cli-error` — it must never be read as empty
//   config and trigger a write. An empty serve config is only accepted at exit 0;
//   a nonzero serve exit is cli-error, not "unconfigured".
// - **Schema drift:** invalid JSON, or JSON missing a field the machine depends
//   on (`BackendState`, `Self`, or `CertDomains` renamed/absent), is
//   `unrecognized-status-output`, never undefined-propagation. Running with an
//   empty `Self.DNSName` is drift too: we never build a `:443` URL from an empty
//   host.
// - **Unknown BackendState:** a value outside the known seven (a future Tailscale
//   version) is NOT assumed working — the shape parsed fine, the value is
//   unrecognized, so it reaches the explicit `unknown-backend-state` branch.
// - **Login and not-running states:** `NoState` and `NeedsLogin` both route to
//   login guidance. Each remaining not-running state has its own distinct
//   branch; `InUseOtherUser` (the seventh state) is a real, actionable condition,
//   not "unrecognized".
// - **https-disabled:** `Running` with an empty `CertDomains` means the
//   tailnet-wide HTTPS toggle is off — a real one-time human step.
// - **Serve:** an empty config prints `{}` and means setup hasn't run yet. Serve
//   pointing at a *different* loopback port is drift, not a match. Unparseable
//   serve output is its own state.
// - **Funnel:** a Funnel allowance on the target hostname-port is a FAILING
//   state — "nothing publicly exposed" is a checked invariant. A **foreground**
//   Funnel config (what `tailscale funnel` without `--bg` writes) is caught too:
//   the check inspects every foreground config, not just the top level.
// - **Probe:** with serve correct, a probe that cannot reach the endpoint (box
//   server down) is `probe-failed`. A box that reports open (unauthenticated)
//   mode is `exposed-unauthenticated` because Serve is already fronting an
//   unprotected box. A reachable answer that is not a beebox auth shape is
//   `posture-ambiguous`. None of these is `ready`.
void test("Each input below scripts the fake tailscale CLI and lands in exactly one stat...", async (t) => {
  const rows: Array<[string, TailscaleDeps]> = [
    ["status exits nonzero", createFakeTailscaleDeps({ status: "", statusCode: 1 })],
    ["serve exits nonzero", createFakeTailscaleDeps({ status: runningStatus, serve: "", serveCode: 1 })],
    ["status is not JSON", withStatus("not json at all")],
    ["status lacks BackendState", withStatus({ Self: { DNSName: "x." } })],
    ["unknown BackendState", withStatus(bs("TeleportingSideways"))],
    ["NoState", withStatus(bs("NoState"))],
    ["NeedsMachineAuth", withStatus(bs("NeedsMachineAuth"))],
    ["Stopped", withStatus(bs("Stopped"))],
    ["Starting", withStatus(bs("Starting"))],
    ["InUseOtherUser", withStatus(bs("InUseOtherUser"))],
    ["no CertDomains", withStatus({ ...runningStatus, CertDomains: [] })],
    ["empty DNSName", withStatus({ BackendState: "Running", Self: { DNSName: "", TailscaleIPs: null }, CertDomains: ["x"] })],
  ];
  const reports = Object.fromEntries(await Promise.all(rows.map(async ([label, deps]) => [label, await report(deps)] as const)));

  t.check(reports, {
    "status exits nonzero": {
      state: "cli-error",
      ok: false,
      command: "tailscale status --json",
      code: 1,
      detail: "(no stderr)",
      nextStep: "`tailscale status --json` exited 1: (no stderr). Fix the Tailscale daemon/permissions, then re-run.",
      docLink: null,
    },
    "serve exits nonzero": {
      state: "cli-error",
      ok: false,
      command: "tailscale serve status --json",
      code: 1,
      detail: "(no stderr)",
      nextStep: "`tailscale serve status --json` exited 1: (no stderr). Fix the Tailscale daemon/permissions, then re-run.",
      docLink: null,
    },
    "status is not JSON": {
      state: "unrecognized-status-output",
      ok: false,
      detail: "not valid JSON: Unexpected token 'o', \"not json at all\" is not valid JSON",
      nextStep: "`tailscale status --json` did not match the expected shape — check your Tailscale version.",
      docLink: null,
    },
    "status lacks BackendState": {
      state: "unrecognized-status-output",
      ok: false,
      detail: "BackendState: Invalid input: expected string, received undefined; Self.TailscaleIPs: Invalid input: expected array, received undefined; CertDomains: Invalid input: expected array, received undefined",
      nextStep: "`tailscale status --json` did not match the expected shape — check your Tailscale version.",
      docLink: null,
    },
    "unknown BackendState": {
      state: "unknown-backend-state",
      ok: false,
      backendState: "TeleportingSideways",
      nextStep: "Unrecognized BackendState 'TeleportingSideways' — refusing to assume a working state. Check your Tailscale version.",
      docLink: null,
    },
    NoState: {
      state: "needs-login",
      ok: false,
      backendState: "NoState",
      nextStep: "Interactive: run `tailscale up`. Headless: run `tailscale up --auth-key=<key>` with a single-use key from the admin console.",
      docLink: "https://tailscale.com/kb/1085/auth-keys",
    },
    NeedsMachineAuth: {
      state: "needs-machine-auth",
      ok: false,
      nextStep: "This machine is waiting for admin approval — approve it in the Tailscale admin console.",
      docLink: "https://tailscale.com/kb/1080/cli",
    },
    Stopped: {
      state: "stopped",
      ok: false,
      nextStep: "Tailscale is installed but stopped — run `tailscale up` to bring it up.",
      docLink: "https://tailscale.com/kb/1080/cli",
    },
    Starting: {
      state: "starting",
      ok: false,
      nextStep: "Tailscale is still starting — wait a moment and re-run `bbx tailscale status`.",
      docLink: null,
    },
    InUseOtherUser: {
      state: "in-use-other-user",
      ok: false,
      nextStep: "The tailscaled daemon is owned by another OS user — switch to that user, or run `tailscale up` as the intended user to take it over.",
      docLink: "https://tailscale.com/kb/1080/cli",
    },
    "no CertDomains": {
      state: "https-disabled",
      ok: false,
      dnsName: "box.tail1234.ts.net",
      nextStep: "Enable HTTPS certificates for your tailnet in the admin console (https://login.tailscale.com/admin/dns), then re-run.",
      docLink: "https://tailscale.com/kb/1153/enabling-https",
    },
    "empty DNSName": {
      state: "unrecognized-status-output",
      ok: false,
      detail: "BackendState is Running but Self.DNSName is empty — cannot resolve the tailnet hostname.",
      nextStep: "`tailscale status --json` reported Running without a Self.DNSName — check your Tailscale version/state.",
      docLink: null,
    },
  });
});

// The serve and probe states, once the node itself is up.
void test("Serve and probe states", async (t) => {
  const wrongServe = {
    Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } },
  };
  const foregroundFunnel = {
    ...correctServe,
    Foreground: { "sess-1": { AllowFunnel: { "box.tail1234.ts.net:443": true } } },
  };
  const rows: Array<[string, TailscaleDeps]> = [
    ["serve empty", createFakeTailscaleDeps({ status: runningStatus, serve: {} })],
    ["serve on another port", createFakeTailscaleDeps({ status: runningStatus, serve: wrongServe })],
    ["serve output garbage", createFakeTailscaleDeps({ status: runningStatus, serve: "<garbage>" })],
    ["foreground Funnel", createFakeTailscaleDeps({ status: runningStatus, serve: foregroundFunnel, probe: enforced401 })],
    ["probe unreachable", withProbe({ reachable: false, status: null })],
    ["probe says open", withProbe({ reachable: true, status: 200, body: JSON.stringify({ open: true }) })],
    ["probe not a beebox shape", withProbe({ reachable: true, status: 200, body: JSON.stringify({ hello: "world" }) })],
  ];
  const reports = Object.fromEntries(await Promise.all(rows.map(async ([label, deps]) => [label, await report(deps)] as const)));

  t.check(reports, {
    "serve empty": {
      state: "serve-unconfigured",
      ok: false,
      dnsName: "box.tail1234.ts.net",
      target: {
        port: 3210,
      },
      nextStep: "Serve is not fronting box.tail1234.ts.net:443 yet — run `bbx tailscale setup --target 3210` to configure it.",
      docLink: "https://tailscale.com/kb/1242/tailscale-serve",
    },
    "serve on another port": {
      state: "serve-drift",
      ok: false,
      dnsName: "box.tail1234.ts.net",
      target: {
        port: 3210,
      },
      pointsAt: "http://127.0.0.1:9999",
      nextStep: "Serve at box.tail1234.ts.net:443 points at http://127.0.0.1:9999, not loopback:3210 — re-run `bbx tailscale setup --target 3210`.",
      docLink: "https://tailscale.com/kb/1242/tailscale-serve",
    },
    "serve output garbage": {
      state: "unrecognized-serve-output",
      ok: false,
      detail: "not valid JSON: Unexpected token '<', \"<garbage>\" is not valid JSON",
      nextStep: "`tailscale serve status --json` did not match the expected shape — check your Tailscale version.",
      docLink: null,
    },
    "foreground Funnel": {
      state: "funnel-enabled",
      ok: false,
      hostPort: "box.tail1234.ts.net:443",
      nextStep: "Funnel is enabled for box.tail1234.ts.net:443 — this target is PUBLIC. Disable it with `tailscale funnel --https=443 off`.",
      docLink: "https://tailscale.com/kb/1223/funnel",
    },
    "probe unreachable": {
      state: "probe-failed",
      ok: false,
      url: "https://box.tail1234.ts.net/",
      status: null,
      nextStep: "Serve is configured for box.tail1234.ts.net:443 but https://box.tail1234.ts.net/auth/me did not respond — check that the box server on loopback:3210 is running.",
      docLink: null,
    },
    "probe says open": {
      state: "exposed-unauthenticated",
      ok: false,
      url: "https://box.tail1234.ts.net/",
      nextStep: "https://box.tail1234.ts.net/ is served to the tailnet but reports open (UNAUTHENTICATED) mode — Serve is live in front of an unprotected box. Run `bbx tailscale stop`, or give the box real authentication, immediately.",
      docLink: null,
    },
    "probe not a beebox shape": {
      state: "posture-ambiguous",
      ok: false,
      url: "https://box.tail1234.ts.net/",
      detail: "https://box.tail1234.ts.net/auth/me did not report a recognizable beebox auth posture (status 200).",
      nextStep: "https://box.tail1234.ts.net/auth/me responded but not with a beebox auth shape — refusing to call this ready. Confirm the loopback target is the auth-gated bbx server.",
      docLink: null,
    },
  });
});

// ## Reports carry more than the state
//
// Some states also carry fields a caller acts on. The `ok` flag is true only
// for `ready`. Binary absent (`tailscale` not on PATH, so every call is
// unspawnable) points at the platform install doc; `NeedsLogin` points at the
// auth-key doc for the headless path; a Funnel allowance on the target fails
// even when the serve mapping is otherwise correct; `ready` names the working
// URL once serve is correct and `/auth/me` reports enforced auth (a `{error:…}`
// 401).
//
// **A served guarded router is ready too.** When Serve fronts the router
// loopback port and the SERVED `/__router/status` denies anonymously (401 +
// header), status is `ready` with `guarded: true` — it proved the gate over the
// real Serve path, not `/auth/me` (the router has none).
void test("Some states also carry fields a caller acts on.", async (t) => {
  const funnelServe = { ...correctServe, AllowFunnel: { "box.tail1234.ts.net:443": true } };
  const rows: TailscaleDeps[] = [
    createFakeTailscaleDeps({ binaryPresent: false }),
    withStatus(bs("NeedsLogin")),
    createFakeTailscaleDeps({ status: runningStatus, serve: funnelServe, probe: enforced401 }),
    withProbe(enforced401),
    createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, routerProbe: guardedRouterProbe }),
  ];
  const reports = await Promise.all(rows.map((deps) => report(deps)));

  t.check(reports, [
    {
      state: "binary-absent",
      ok: false,
      nextStep: "Install Tailscale for this platform, then run `tailscale up`.",
      docLink: "https://tailscale.com/download",
    },
    {
      state: "needs-login",
      ok: false,
      backendState: "NeedsLogin",
      nextStep: "Interactive: run `tailscale up`. Headless: run `tailscale up --auth-key=<key>` with a single-use key from the admin console.",
      docLink: "https://tailscale.com/kb/1085/auth-keys",
    },
    {
      state: "funnel-enabled",
      ok: false,
      hostPort: "box.tail1234.ts.net:443",
      nextStep: "Funnel is enabled for box.tail1234.ts.net:443 — this target is PUBLIC. Disable it with `tailscale funnel --https=443 off`.",
      docLink: "https://tailscale.com/kb/1223/funnel",
    },
    {
      state: "ready",
      ok: true,
      url: "https://box.tail1234.ts.net/",
      status: 401,
      guarded: false,
      nextStep: "Reachable at https://box.tail1234.ts.net/ (proves the local serve path only; live acceptance comes from a second device on the tailnet).",
      docLink: null,
    },
    {
      state: "ready",
      ok: true,
      url: "https://box.tail1234.ts.net/",
      status: 401,
      guarded: true,
      nextStep: "The guarded dev router is reachable at https://box.tail1234.ts.net/ and denies anonymous `/__router/status` (401) over Serve (proves the local serve path only; live acceptance comes from a second device on the tailnet).",
      docLink: null,
    },
  ]);
});

// ## Pure parsers
//
// The zod schema rejects the drifted shape at the boundary — including a missing
// `Self` key (an always-emitted status member) — while a new *field* the machine
// doesn't read passes through (only a renamed/absent required field is drift):
void test("The zod schema rejects the drifted shape at the boundary — including a missin...", async (t) => {
  t.check([
    parseStatusJson(JSON.stringify({ Self: {} })),
    parseStatusJson(JSON.stringify({ BackendState: "Running", CertDomains: null })),
    parseStatusJson(JSON.stringify({ BackendState: "Running", Self: null, CertDomains: null, BrandNewField: 1 })),
  ], [
    {
      ok: false,
      message: "BackendState: Invalid input: expected string, received undefined; Self.DNSName: Invalid input: expected string, received undefined; Self.TailscaleIPs: Invalid input: expected array, received undefined; CertDomains: Invalid input: expected array, received undefined",
    },
    {
      ok: false,
      message: "Self: Invalid input: expected object, received undefined",
    },
    {
      ok: true,
      value: {
        BackendState: "Running",
        Self: null,
        CertDomains: null,
        BrandNewField: 1,
      },
    },
  ]);
});

// `toBackendState` maps only the seven known `ipn.State` values; everything else
// is `null`:
void test("toBackendState maps only the seven known ipn.State values; everything else is...", async (t) => {
  t.check([toBackendState("Running"), toBackendState("InUseOtherUser"), toBackendState("Nonsense")], [
    "Running",
    "InUseOtherUser",
    null,
  ]);
});

// `hasFunnelForTarget` checks both the top level and foreground configs:
void test("hasFunnelForTarget checks both the top level and foreground configs:", async (t) => {
  t.check(
    [
      hasFunnelForTarget({ AllowFunnel: { "h:443": true } }, "h:443"),
      hasFunnelForTarget({ Foreground: { s: { AllowFunnel: { "h:443": true } } } }, "h:443"),
      hasFunnelForTarget({ Foreground: { s: { AllowFunnel: { "other:443": true } } } }, "h:443"),
    ],
    [
    true,
    true,
    false,
  ],
  );
});

// `loopbackProxyPort` accepts a bare port or a loopback URL, and rejects a
// non-loopback target (which must not read as a match):
void test("loopbackProxyPort accepts a bare port or a loopback URL, and rejects a non-lo...", async (t) => {
  t.check(
    [
      loopbackProxyPort("3210"),
      loopbackProxyPort("http://127.0.0.1:3210"),
      loopbackProxyPort("localhost:3210"),
      loopbackProxyPort("http://10.0.0.5:3210"),
    ],
    [
    3210,
    3210,
    3210,
    null,
  ],
  );
});

// An empty serve config parses to `{}` (Tailscale prints `{}` or `null` when
// serve is unconfigured):
void test("An empty serve config parses to {} (Tailscale prints {} or null when serve is...", async (t) => {
  t.check([parseServeConfig(""), parseServeConfig("null"), parseServeConfig("{}")], [
    {
      ok: true,
      value: {},
    },
    {
      ok: true,
      value: {},
    },
    {
      ok: true,
      value: {},
    },
  ]);
});

// ## `--json` output shape
//
// `reportToJson` returns the structured report agents consume: `ok`, `state`, and
// the per-state fields.
void test("reportToJson returns the structured report agents consume:", async (t) => {
  t.check(reportToJson(await report(withProbe(authed200))), {
    state: "ready",
    ok: true,
    url: "https://box.tail1234.ts.net/",
    status: 200,
    guarded: false,
    nextStep: str`${any(String)}`,
    docLink: null,
  });
});

// ## Human output: one glyph line, condition, next step, doc link
//
// Only `ready` gets the `✓` glyph. The guarded-router summary names the router
// and the anonymous-denied probe.
void test("Only ready gets the ✓ glyph.", async (t) => {
  t.checkText(formatReportHuman(await report(createFakeTailscaleDeps({ binaryPresent: false }))), `✗ tailscale: binary-absent
  the \`tailscale\` CLI is not on PATH
  next: Install Tailscale for this platform, then run \`tailscale up\`.
  docs: https://tailscale.com/download`);
  t.checkText(formatReportHuman(await report(withProbe(enforced401))), `✓ tailscale: ready
  serve is fronting the target; https://box.tail1234.ts.net/auth/me responded (401)
  next: Reachable at https://box.tail1234.ts.net/ (proves the local serve path only; live acceptance comes from a second device on the tailnet).`);
  const guarded = createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, routerProbe: guardedRouterProbe });
  t.checkText(formatReportHuman(await report(guarded)), `✓ tailscale: ready
  serve is fronting the guarded dev router; anonymous https://box.tail1234.ts.net/__router/status was denied (401)
  next: The guarded dev router is reachable at https://box.tail1234.ts.net/ and denies anonymous \`/__router/status\` (401) over Serve (proves the local serve path only; live acceptance comes from a second device on the tailnet).`);
});

// ## Track C: router-guarded target classification
//
// `classifyTargetPosture` reads the loopback `/__router/status` FIRST. A guarded
// router (anonymous 401 + `x-bbx-router-guarded`) is an ALLOWED posture — its
// fail-closed gate is live, so Serve fronting it exposes nothing unauthenticated.
//
// An UNGATED router (200 + `routerPort`/`worktrees`, a pre-Track-B build) is
// still refused, and the message says to UPDATE the router so its gate is live,
// not "never a valid target".
//
// A 401 on `/__router/status` WITHOUT the header is not treated as a guarded
// router: it falls through to the `/auth/me` posture read (here enforced), as a
// normal bbx serve/hub with no router shape does.
void test("classifyTargetPosture reads the loopback /router/status FIRST.", async (t) => {
  const cases: Array<[string, TailscaleDeps]> = [
    ["guarded router", createFakeTailscaleDeps({ routerProbe: guardedRouterProbe })],
    ["ungated router", createFakeTailscaleDeps({ routerProbe: ungatedRouterProbe })],
    ["401 without header", createFakeTailscaleDeps({
      routerProbe: { reachable: true, status: 401, body: "Unauthorized" },
      probe: enforced401,
    })],
    ["plain serve", createFakeTailscaleDeps({ probe: enforced401 })],
  ];
  const postures = Object.fromEntries(await Promise.all(cases.map(async ([label, deps]) => [label, await classifyTargetPosture(deps, 3210)] as const)));
  const ungated = await classifyTargetPosture(createFakeTailscaleDeps({ routerProbe: ungatedRouterProbe }), 3210);
  if (ungated.kind === "enforced" || ungated.kind === "router-guarded") throw new Error(`expected a refusal, got ${ungated.kind}`);

  t.check(postures, {
    "guarded router": {
      kind: "router-guarded",
    },
    "ungated router": {
      kind: "router",
    },
    "401 without header": {
      kind: "enforced",
    },
    "plain serve": {
      kind: "enforced",
    },
  });
  t.checkText(describeRefusal(ungated, 3210), "REFUSING to expose loopback:3210 — it answers `/__router/status` 200 with the dev router's own status JSON, which means this router is NOT running the Track-B auth gate (a pre-Track-B build). Update/rebuild the router so its gate denies anonymous access (a guarded router answers `/__router/status` with 401), then re-run `bbx tailscale setup` — a guarded dev router is exposable, an ungated one is not.");
});

// ## `deriveTailscaleBaseUrl`: the admin settings page's Tailscale URL
//
// Pure helper behind the `admin.tailscaleBaseUrl` tRPC query — turns a parsed
// `serve status --json` payload into the box's public `https://…` URL, or null
// when there's no `Web` mapping. The port suffix is dropped. With multiple hosts
// it prefers the one whose handler proxies to loopback (the box's own front) over
// an unrelated non-loopback mapping. A host with no Handlers at all (unusual, but
// the schema allows it) still counts as an exposed HTTPS mapping and falls back
// to "first host".
void test("Pure helper behind the admin.tailscaleBaseUrl tRPC query — turns a parsed ser...", async (t) => {
  const inputs: Array<[string, ServeConfigJson]> = [
    ["no Web section", {}],
    ["single HTTPS host", correctServe],
    ["loopback host preferred", {
      Web: {
        "unrelated.example.ts.net:443": { Handlers: { "/": { Proxy: "http://192.168.1.5:9000" } } },
        "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3210" } } },
      },
    }],
    ["no Handlers", { Web: { "box.tail1234.ts.net:443": {} } }],
  ];

  t.check(Object.fromEntries(inputs.map(([label, serve]) => [label, deriveTailscaleBaseUrl(serve)])), {
    "no Web section": null,
    "single HTTPS host": "https://box.tail1234.ts.net",
    "loopback host preferred": "https://box.tail1234.ts.net",
    "no Handlers": "https://box.tail1234.ts.net",
  });
});
