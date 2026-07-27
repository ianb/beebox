# Tailscale status state machine

`cb tailscale status` is a fail-closed state machine over `tailscale`'s CLI
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
import { runTailscaleStatus, reportToJson } from "../../src/services/tailscale-status.js";
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
const guardedRouterProbe = { reachable: true, status: 401, headers: { "x-cb-router-guarded": "1" }, body: JSON.stringify({ error: "owner-session-required" }) };
const ungatedRouterProbe = { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, routerPid: 1, worktrees: {} }) };

// The two enforced-auth probe shapes callback-box's `/auth/me` produces.
const enforced401 = { reachable: true, status: 401, body: JSON.stringify({ error: "Not authenticated" }) };
const authed200 = {
  reachable: true,
  status: 200,
  body: JSON.stringify({ email: "a@b.c", name: "A", isOwner: true, boxes: [] }),
};

// `runTailscaleStatus` receives an already-resolved concrete target (the CLI
// turns `--target`/auto-discovery into a `{ port }` via `resolveTargetOrDiscover`
// — see tailscale-discovery.doctest.md). This helper mirrors that boundary.
const state = (deps, port) => runTailscaleStatus(deps, { target: { port } }).then((r) => r.state);
```

## State 1: binary absent

When `tailscale` is not on PATH, every call is unspawnable — the report points
at the platform install doc.

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ binaryPresent: false }),
  { target: { port: 3210 } },
);
[report.state, report.ok, report.docLink]
=> [
  "binary-absent",
  false,
  "https://tailscale.com/download"
]
```

## CLI error: nonzero exit is its own state, never parsed as config

A `tailscale` call that spawns but exits nonzero (dead daemon, permission
error) is a DISTINCT `cli-error` — it must never be read as empty config and
trigger a write.

```ts
await state(createFakeTailscaleDeps({ status: "", statusCode: 1 }), 3210)
=> cli-error
```

An empty serve config is only accepted at exit 0 — a nonzero serve exit is
cli-error, not "unconfigured":

```ts
await state(createFakeTailscaleDeps({ status: runningStatus, serve: "", serveCode: 1 }), 3210)
=> cli-error
```

## Schema drift: unrecognized status output

Invalid JSON, or JSON missing a field the machine depends on (`BackendState`,
`Self`, or `CertDomains` renamed/absent), is its own state — never
undefined-propagation.

```ts
await state(createFakeTailscaleDeps({ status: "not json at all" }), 3210)
=> unrecognized-status-output
```

```ts
await state(createFakeTailscaleDeps({ status: { Self: { DNSName: "x." } } }), 3210)
=> unrecognized-status-output
```

The zod schema rejects the drifted shape at the boundary — including a missing
`Self` key (an always-emitted status member):

```ts
[
  parseStatusJson(JSON.stringify({ Self: {} })).ok,
  parseStatusJson(JSON.stringify({ BackendState: "Running", CertDomains: null })).ok,
]
=> [
  false,
  false
]
```

A new *field* the machine doesn't read passes through (only a renamed/absent
required field is drift):

```ts
parseStatusJson(JSON.stringify({ BackendState: "Running", Self: null, CertDomains: null, BrandNewField: 1 })).ok
=> true
```

## Unknown BackendState: fail-closed

A `BackendState` value outside the known seven (a future Tailscale version) is
NOT assumed working — it reaches the explicit unknown branch. This is distinct
from schema drift: the shape parsed fine, the value is unrecognized.

```ts
await state(createFakeTailscaleDeps({ status: bs("TeleportingSideways") }), 3210)
=> unknown-backend-state
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

## States 2-3: each backend state its own branch

`NoState` and `NeedsLogin` both route to the login guidance (with the auth-key
doc for the headless path):

```ts
await state(createFakeTailscaleDeps({ status: bs("NoState") }), 3210)
=> needs-login
```

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: bs("NeedsLogin") }),
  { target: { port: 3210 } },
);
[report.state, report.docLink]
=> [
  "needs-login",
  "https://tailscale.com/kb/1085/auth-keys"
]
```

Each remaining not-running state has its own distinct branch — `InUseOtherUser`
(the seventh state) is a real, actionable condition, not "unrecognized":

```ts
const cases = ["NeedsMachineAuth", "Stopped", "Starting", "InUseOtherUser"];
const states = [];
for (const b of cases) {
  states.push(await state(createFakeTailscaleDeps({ status: bs(b) }), 3210));
};
states.join(", ")
=> needs-machine-auth, stopped, starting, in-use-other-user
```

## State 4: Running but HTTPS certs disabled

`Running` with an empty (or null) `CertDomains` means the tailnet-wide HTTPS
toggle is off — a real one-time human step, linked to the admin console.

```ts
await state(createFakeTailscaleDeps({ status: { ...runningStatus, CertDomains: [] } }), 3210)
=> https-disabled
```

Running with an empty `Self.DNSName` is drift — we never build a `:443` URL
from an empty host:

```ts
await state(
  createFakeTailscaleDeps({ status: { BackendState: "Running", Self: { DNSName: "", TailscaleIPs: null }, CertDomains: ["x"] } }),
  3210,
)
=> unrecognized-status-output
```

## State 5: serve drift and the no-Funnel invariant

Serve unconfigured (empty config prints `{}`) means setup hasn't run yet:

```ts
await state(createFakeTailscaleDeps({ status: runningStatus, serve: {} }), 3210)
=> serve-unconfigured
```

Serve pointing at a *different* loopback port is drift, not a match:

```ts
const wrongServe = {
  Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } },
};
await state(createFakeTailscaleDeps({ status: runningStatus, serve: wrongServe }), 3210)
=> serve-drift
```

**A Funnel allowance on the target hostname-port is a FAILING state** — "nothing
publicly exposed" is a checked invariant, not an assumption. It fails even when
the serve mapping is otherwise correct:

```ts
const funnelServe = {
  ...correctServe,
  AllowFunnel: { "box.tail1234.ts.net:443": true },
};
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: runningStatus, serve: funnelServe, probe: enforced401 }),
  { target: { port: 3210 } },
);
[report.state, report.ok]
=> [
  "funnel-enabled",
  false
]
```

A **foreground** Funnel config (what `tailscale funnel` without `--bg` writes)
is caught too — the check inspects every foreground config, not just the top
level:

```ts
const foregroundFunnel = {
  ...correctServe,
  Foreground: { "sess-1": { AllowFunnel: { "box.tail1234.ts.net:443": true } } },
};
await state(createFakeTailscaleDeps({ status: runningStatus, serve: foregroundFunnel, probe: enforced401 }), 3210)
=> funnel-enabled
```

`hasFunnelForTarget` checks both levels directly:

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

Unparseable serve output is its own drift-distinct state:

```ts
await state(createFakeTailscaleDeps({ status: runningStatus, serve: "<garbage>" }), 3210)
=> unrecognized-serve-output
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

## State 6: serve correct → strict posture classification

With serve correct and `/auth/me` reporting enforced auth (a `{error:…}` 401),
the report is `ready` (the only `ok: true` state) and names the working URL.

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, probe: enforced401 }),
  { target: { port: 3210 } },
);
[report.state, report.ok, report.state === "ready" ? report.url : null]
=> [
  "ready",
  true,
  "https://box.tail1234.ts.net/"
]
```

Serve correct but the probe cannot reach the endpoint (box server down) is a
distinct failing state, not `ready`:

```ts
await state(
  createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, probe: { reachable: false, status: null } }),
  3210,
)
=> probe-failed
```

**Serve is live but the box reports open (unauthenticated) mode** — a serious
failing state (`exposed-unauthenticated`), never `ready`, because Serve is
already fronting an unprotected box:

```ts
await state(
  createFakeTailscaleDeps({
    status: runningStatus,
    serve: correctServe,
    probe: { reachable: true, status: 200, body: JSON.stringify({ open: true }) },
  }),
  3210,
)
=> exposed-unauthenticated
```

An unrecognizable posture (reachable, but not a callback-box auth shape) is its
own failing state, not `ready`:

```ts
await state(
  createFakeTailscaleDeps({
    status: runningStatus,
    serve: correctServe,
    probe: { reachable: true, status: 200, body: JSON.stringify({ hello: "world" }) },
  }),
  3210,
)
=> posture-ambiguous
```

## `--json` output shape

`reportToJson` returns the structured report agents consume: `ok`, `state`, and
the per-state fields.

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, probe: authed200 }),
  { target: { port: 3210 } },
);
JSON.stringify(reportToJson(report), null, 2)
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

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ binaryPresent: false }),
  { target: { port: 3210 } },
);
formatReportHuman(report)
=>
✗ tailscale: binary-absent
  the `tailscale` CLI is not on PATH
  next: Install Tailscale for this platform, then run `tailscale up`.
  docs: https://tailscale.com/download
```

Only `ready` gets the `✓` glyph:

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, probe: enforced401 }),
  { target: { port: 3210 } },
);
formatReportHuman(report).split("\n")[0]
=> ✓ tailscale: ready
```

## Track C: router-guarded target classification

`classifyTargetPosture` reads the loopback `/__router/status` FIRST. A guarded
router (anonymous 401 + `x-cb-router-guarded`) is now an ALLOWED posture — its
fail-closed gate is live, so Serve fronting it exposes nothing unauthenticated.

```ts
const deps = createFakeTailscaleDeps({ routerProbe: guardedRouterProbe });
(await classifyTargetPosture(deps, 3210)).kind
=> router-guarded
```

An UNGATED router (200 + `routerPort`/`worktrees`, a pre-Track-B build) is still
refused — but the message now says to UPDATE the router so its gate is live,
not "never a valid target":

```ts
const deps = createFakeTailscaleDeps({ routerProbe: ungatedRouterProbe });
const posture = await classifyTargetPosture(deps, 3210);
[posture.kind, describeRefusal(posture, 3210).includes("Update/rebuild the router")]
=> [
  "router",
  true
]
```

A 401 on `/__router/status` WITHOUT the header is not treated as a guarded
router — it falls through to the `/auth/me` posture read (here enforced):

```ts
const deps = createFakeTailscaleDeps({
  routerProbe: { reachable: true, status: 401, body: "Unauthorized" },
  probe: enforced401,
});
(await classifyTargetPosture(deps, 3210)).kind
=> enforced
```

A normal cb serve/hub (no router shape on `/__router/status`) reads its
`/auth/me` posture as before:

```ts
(await classifyTargetPosture(createFakeTailscaleDeps({ probe: enforced401 }), 3210)).kind
=> enforced
```

## Track C: status reports a served guarded router as ready

When Serve fronts the router loopback port and the SERVED `/__router/status`
denies anonymously (401 + header), status is `ready` with `guarded: true` — it
proved the gate over the real Serve path, not `/auth/me` (the router has none).

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, routerProbe: guardedRouterProbe }),
  { target: { port: 3210 } },
);
[report.state, report.ok, report.state === "ready" ? report.guarded : null, report.state === "ready" ? report.url : null]
=> [
  "ready",
  true,
  true,
  "https://box.tail1234.ts.net/"
]
```

The human summary names the guarded router and the anonymous-denied probe:

```ts
const report = await runTailscaleStatus(
  createFakeTailscaleDeps({ status: runningStatus, serve: correctServe, routerProbe: guardedRouterProbe }),
  { target: { port: 3210 } },
);
formatReportHuman(report).split("\n")[1]
=>   serve is fronting the guarded dev router; anonymous https://box.tail1234.ts.net/__router/status was denied (401)
```

## `deriveTailscaleBaseUrl`: the admin settings page's Tailscale URL

Pure helper behind the `admin.tailscaleBaseUrl` tRPC query — turns a parsed
`serve status --json` payload into the box's public `https://…` URL, or null
when there's no `Web` mapping.

No `Web` section at all (not exposed):

```ts
deriveTailscaleBaseUrl({})
=> null
```

A single HTTPS host — the port suffix is dropped:

```ts
deriveTailscaleBaseUrl(correctServe)
=> https://box.tail1234.ts.net
```

Multiple hosts: prefers the one whose handler proxies to loopback (the box's
own front) over an unrelated non-loopback mapping:

```ts
deriveTailscaleBaseUrl({
  Web: {
    "unrelated.example.ts.net:443": { Handlers: { "/": { Proxy: "http://192.168.1.5:9000" } } },
    "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3210" } } },
  },
})
=> https://box.tail1234.ts.net
```

A host with no Handlers at all (unusual, but the schema allows it) still
counts as an exposed HTTPS mapping and falls back to "first host":

```ts
deriveTailscaleBaseUrl({ Web: { "box.tail1234.ts.net:443": {} } })
=> https://box.tail1234.ts.net
```
