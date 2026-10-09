# Tailscale status state machine

`bbx tailscale status` is a fail-closed state machine over `tailscale`'s CLI
output. It runs against injected fake deps (`createFakeTailscaleDeps`) so every
state is testable with no tailnet. Each fake scripts the two subcommands
(`tailscale status --json`, `tailscale serve status --json`) plus the `/auth/me`
probe, and per-command exit codes. See
`docs/implemented-plans/tailscale-expose-and-protect.md` Track B.

```ts setup
import {
  parseStatusJson,
  parseServeConfig,
  loopbackProxyPort,
  hasFunnelForTarget,
  toBackendState,
  deriveTailscaleBaseUrl,
} from "../../src/services/tailscale.js";
import { createFakeTailscaleDeps } from "../../src/services/tailscale-fake.js";
import { runTailscaleStatus, reportToJson } from "../../src/services/tailscale-status/core.js";
import { classifyTargetPosture, describeRefusal } from "../../src/services/tailscale-target.js";
import { formatReportHuman } from "../../src/cli/commands/tailscale.js";

// Real `tailscale status --json` emits Self and CertDomains WITHOUT omitempty —
// always present, JSON `null` before the node is up. Model a bare backend state
// that way so the schema's required-key check is exercised realistically.
const bs = (BackendState) => ({ BackendState, Self: null, CertDomains: null });

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
const withProbe = (probe) => createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, probe });
const withStatus = (status) => createFakeTailscaleDeps({ status });
const report = (deps) => runTailscaleStatus(deps, { target: { port: 3210 } });
```

## Every state is its own branch

Each input below scripts the fake `tailscale` CLI and lands in exactly one
state of the machine. Reading the table top to bottom follows the order the
machine checks things.

- **cli-error:** a `tailscale` call that spawns but exits nonzero (dead daemon,
  permission error) is a DISTINCT `cli-error` — it must never be read as empty
  config and trigger a write. An empty serve config is only accepted at exit 0;
  a nonzero serve exit is cli-error, not "unconfigured".
- **Schema drift:** invalid JSON, or JSON missing a field the machine depends
  on (`BackendState`, `Self`, or `CertDomains` renamed/absent), is
  `unrecognized-status-output`, never undefined-propagation. Running with an
  empty `Self.DNSName` is drift too: we never build a `:443` URL from an empty
  host.
- **Unknown BackendState:** a value outside the known seven (a future Tailscale
  version) is NOT assumed working — the shape parsed fine, the value is
  unrecognized, so it reaches the explicit `unknown-backend-state` branch.
- **Login and not-running states:** `NoState` and `NeedsLogin` both route to
  login guidance. Each remaining not-running state has its own distinct
  branch; `InUseOtherUser` (the seventh state) is a real, actionable condition,
  not "unrecognized".
- **https-disabled:** `Running` with an empty `CertDomains` means the
  tailnet-wide HTTPS toggle is off — a real one-time human step.
- **Serve:** an empty config prints `{}` and means setup hasn't run yet. Serve
  pointing at a *different* loopback port is drift, not a match. Unparseable
  serve output is its own state.
- **Funnel:** a Funnel allowance on the target hostname-port is a FAILING
  state — "nothing publicly exposed" is a checked invariant. A **foreground**
  Funnel config (what `tailscale funnel` without `--bg` writes) is caught too:
  the check inspects every foreground config, not just the top level.
- **Probe:** with serve correct, a probe that cannot reach the endpoint (box
  server down) is `probe-failed`. A box that reports open (unauthenticated)
  mode is `exposed-unauthenticated` because Serve is already fronting an
  unprotected box. A reachable answer that is not a beebox auth shape is
  `posture-ambiguous`. None of these is `ready`.

```ts
const wrongServe = {
  Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } },
};
const foregroundFunnel = {
  ...correctServe,
  Foreground: { "sess-1": { AllowFunnel: { "box.tail1234.ts.net:443": true } } },
};
const rows = [
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
  ["serve empty", createFakeTailscaleDeps({ status: runningStatus, serve: {} })],
  ["serve on another port", createFakeTailscaleDeps({ status: runningStatus, serve: wrongServe })],
  ["serve output garbage", createFakeTailscaleDeps({ status: runningStatus, serve: "<garbage>" })],
  ["foreground Funnel", createFakeTailscaleDeps({ status: runningStatus, serve: foregroundFunnel, probe: enforced401 })],
  ["probe unreachable", withProbe({ reachable: false, status: null })],
  ["probe says open", withProbe({ reachable: true, status: 200, body: JSON.stringify({ open: true }) })],
  ["probe not a beebox shape", withProbe({ reachable: true, status: 200, body: JSON.stringify({ hello: "world" }) })],
];
const lines = [];
for (const [label, deps] of rows) {
  lines.push(`${label}: ${(await report(deps)).state}`);
}

lines.join("\n")
=>
status exits nonzero: cli-error
serve exits nonzero: cli-error
status is not JSON: unrecognized-status-output
status lacks BackendState: unrecognized-status-output
unknown BackendState: unknown-backend-state
NoState: needs-login
NeedsMachineAuth: needs-machine-auth
Stopped: stopped
Starting: starting
InUseOtherUser: in-use-other-user
no CertDomains: https-disabled
empty DNSName: unrecognized-status-output
serve empty: serve-unconfigured
serve on another port: serve-drift
serve output garbage: unrecognized-serve-output
foreground Funnel: funnel-enabled
probe unreachable: probe-failed
probe says open: exposed-unauthenticated
probe not a beebox shape: posture-ambiguous
```

## Reports carry more than the state

Some states also carry fields a caller acts on. The `ok` flag is true only
for `ready`. Binary absent (`tailscale` not on PATH, so every call is
unspawnable) points at the platform install doc; `NeedsLogin` points at the
auth-key doc for the headless path; a Funnel allowance on the target fails
even when the serve mapping is otherwise correct; `ready` names the working
URL once serve is correct and `/auth/me` reports enforced auth (a `{error:…}`
401).

**A served guarded router is ready too.** When Serve fronts the router
loopback port and the SERVED `/__router/status` denies anonymously (401 +
header), status is `ready` with `guarded: true` — it proved the gate over the
real Serve path, not `/auth/me` (the router has none).

```ts
const funnelServe = { ...correctServe, AllowFunnel: { "box.tail1234.ts.net:443": true } };
const rows = [
  [createFakeTailscaleDeps({ binaryPresent: false }), ["state", "ok", "docLink"]],
  [withStatus(bs("NeedsLogin")), ["state", "docLink"]],
  [createFakeTailscaleDeps({ status: runningStatus, serve: funnelServe, probe: enforced401 }), ["state", "ok"]],
  [withProbe(enforced401), ["state", "ok", "url"]],
  [createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, routerProbe: guardedRouterProbe }), ["state", "ok", "guarded", "url"]],
];
const lines = [];
for (const [deps, keys] of rows) {
  const r = await report(deps);
  lines.push(JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k] ?? null]))));
}

lines.join("\n")
=>
{"state":"binary-absent","ok":false,"docLink":"https://tailscale.com/download"}
{"state":"needs-login","docLink":"https://tailscale.com/kb/1085/auth-keys"}
{"state":"funnel-enabled","ok":false}
{"state":"ready","ok":true,"url":"https://box.tail1234.ts.net/"}
{"state":"ready","ok":true,"guarded":true,"url":"https://box.tail1234.ts.net/"}
```

## Pure parsers

The zod schema rejects the drifted shape at the boundary — including a missing
`Self` key (an always-emitted status member) — while a new *field* the machine
doesn't read passes through (only a renamed/absent required field is drift):

```ts
[
  parseStatusJson(JSON.stringify({ Self: {} })).ok,
  parseStatusJson(JSON.stringify({ BackendState: "Running", CertDomains: null })).ok,
  parseStatusJson(JSON.stringify({ BackendState: "Running", Self: null, CertDomains: null, BrandNewField: 1 })).ok,
]
=> [
  false,
  false,
  true
]
```

`toBackendState` maps only the seven known `ipn.State` values; everything else
is `null`:

```ts
[toBackendState("Running"), toBackendState("InUseOtherUser"), toBackendState("Nonsense")]
=> [
  "Running",
  "InUseOtherUser",
  null
]
```

`hasFunnelForTarget` checks both the top level and foreground configs:

```ts
[
  hasFunnelForTarget({ AllowFunnel: { "h:443": true } }, "h:443"),
  hasFunnelForTarget({ Foreground: { s: { AllowFunnel: { "h:443": true } } } }, "h:443"),
  hasFunnelForTarget({ Foreground: { s: { AllowFunnel: { "other:443": true } } } }, "h:443"),
]
=> [
  true,
  true,
  false
]
```

`loopbackProxyPort` accepts a bare port or a loopback URL, and rejects a
non-loopback target (which must not read as a match):

```ts
[
  loopbackProxyPort("3210"),
  loopbackProxyPort("http://127.0.0.1:3210"),
  loopbackProxyPort("localhost:3210"),
  loopbackProxyPort("http://10.0.0.5:3210"),
]
=> [
  3210,
  3210,
  3210,
  null
]
```

An empty serve config parses to `{}` (Tailscale prints `{}` or `null` when
serve is unconfigured):

```ts
[parseServeConfig("").ok, parseServeConfig("null").ok, parseServeConfig("{}").ok]
=> [
  true,
  true,
  true
]
```

## `--json` output shape

`reportToJson` returns the structured report agents consume: `ok`, `state`, and
the per-state fields.

```ts
JSON.stringify(reportToJson(await report(withProbe(authed200))), null, 2)
=>
{
  "state": "ready",
  "ok": true,
  "url": "https://box.tail1234.ts.net/",
  "status": 200,
  "guarded": false,
  "nextStep": "«*»",
  "docLink": null
}
```

## Human output: one glyph line, condition, next step, doc link

Only `ready` gets the `✓` glyph. The guarded-router summary names the router
and the anonymous-denied probe.

```ts
print(formatReportHuman(await report(createFakeTailscaleDeps({ binaryPresent: false }))));
print(formatReportHuman(await report(withProbe(enforced401))).split("\n")[0]);
const guarded = createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, routerProbe: guardedRouterProbe });
formatReportHuman(await report(guarded)).split("\n")[1]
=>
✗ tailscale: binary-absent
  the `tailscale` CLI is not on PATH
  next: Install Tailscale for this platform, then run `tailscale up`.
  docs: https://tailscale.com/download
✓ tailscale: ready
  serve is fronting the guarded dev router; anonymous https://box.tail1234.ts.net/__router/status was denied (401)
```

## Track C: router-guarded target classification

`classifyTargetPosture` reads the loopback `/__router/status` FIRST. A guarded
router (anonymous 401 + `x-bbx-router-guarded`) is an ALLOWED posture — its
fail-closed gate is live, so Serve fronting it exposes nothing unauthenticated.

An UNGATED router (200 + `routerPort`/`worktrees`, a pre-Track-B build) is
still refused, and the message says to UPDATE the router so its gate is live,
not "never a valid target".

A 401 on `/__router/status` WITHOUT the header is not treated as a guarded
router: it falls through to the `/auth/me` posture read (here enforced), as a
normal bbx serve/hub with no router shape does.

```ts
const cases = [
  ["guarded router", createFakeTailscaleDeps({ routerProbe: guardedRouterProbe })],
  ["ungated router", createFakeTailscaleDeps({ routerProbe: ungatedRouterProbe })],
  ["401 without header", createFakeTailscaleDeps({
    routerProbe: { reachable: true, status: 401, body: "Unauthorized" },
    probe: enforced401,
  })],
  ["plain serve", createFakeTailscaleDeps({ probe: enforced401 })],
];
const lines = [];
for (const [label, deps] of cases) {
  lines.push(`${label}: ${(await classifyTargetPosture(deps, 3210)).kind}`);
}
const ungated = await classifyTargetPosture(cases[1][1], 3210);
lines.push(`refusal says update: ${describeRefusal(ungated, 3210).includes("Update/rebuild the router")}`);

lines.join("\n")
=>
guarded router: router-guarded
ungated router: router
401 without header: enforced
plain serve: enforced
refusal says update: true
```

## `deriveTailscaleBaseUrl`: the admin settings page's Tailscale URL

Pure helper behind the `admin.tailscaleBaseUrl` tRPC query — turns a parsed
`serve status --json` payload into the box's public `https://…` URL, or null
when there's no `Web` mapping. The port suffix is dropped. With multiple hosts
it prefers the one whose handler proxies to loopback (the box's own front) over
an unrelated non-loopback mapping. A host with no Handlers at all (unusual, but
the schema allows it) still counts as an exposed HTTPS mapping and falls back
to "first host".

```ts
const inputs = [
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

inputs.map(([label, serve]) => `${label}: ${deriveTailscaleBaseUrl(serve)}`).join("\n")
=>
no Web section: null
single HTTPS host: https://box.tail1234.ts.net
loopback host preferred: https://box.tail1234.ts.net
no Handlers: https://box.tail1234.ts.net
```
