# Tailscale setup / stop (guided serve-config loop)

`cb tailscale setup` runs the status state machine as a guided loop: it proves
the loopback target is an auth-enforcing callback-box (never the router, never a
non-loopback bind, never open/ambiguous), records exposure intent BEFORE it
mutates Serve, writes a persistent path-scoped mapping (preserving unrelated
ones), and re-verifies. `cb tailscale stop` removes only that target's mapping(s)
and clears intent ONLY after a readback proves removal. Everything runs against a
stateful fake modeling `tailscale serve`'s incremental semantics — no tailnet, no
TTY. See `docs/implemented-plans/tailscale-expose-and-protect.md` Track B chunk 2.

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runTailscaleSetup, runTailscaleStop } from "../../src/services/tailscale-setup.js";
import { classifyAuthPosture } from "../../src/services/tailscale-target.js";
import { loadExposureFile, recordExposure, clearExposure } from "../../src/services/tailscale-exposure.js";
import { acquireLock, releaseLock } from "../../src/lib/file-lock.js";

// A machine-level exposure file scoped to this test run (record/clear write here).
process.env.CB_TAILSCALE_EXPOSURE_FILE = path.join(
  os.tmpdir(),
  `cb-exposure-setup-test-${process.pid}-${Date.now()}.json`,
);

// A Running status with tailnet HTTPS certs enabled — the serve/probe precondition.
const runningStatus = {
  BackendState: "Running",
  Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  CertDomains: ["box.tail1234.ts.net"],
};

// The enforced-auth probe shape callback-box's `/auth/me` returns unauthenticated.
const enforced401 = { reachable: true, status: 401, body: JSON.stringify({ error: "Not authenticated" }) };

function cmdOk(stdout) {
  return { spawned: true, code: 0, stdout, stderr: "" };
}

const notSpawned = { spawned: false, code: null, stdout: "", stderr: "" };
const setPathOf = (args) => {
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
function makeServeSim(state) {
  state.serve = state.serve ?? {};
  const calls = [];
  const hostPort = () => `${(state.status.Self?.DNSName ?? "").replace(/\.$/, "")}:443`;
  const deps = {
    run: (cmd, args) => {
      if (cmd !== "tailscale") throw new Error(`unexpected command: ${cmd}`);
      calls.push([cmd, ...args].join(" "));
      if (state.binaryPresent === false) return Promise.resolve(notSpawned);
      const sub = args.join(" ");
      if (sub === "status --json") return Promise.resolve(cmdOk(JSON.stringify(state.status)));
      if (sub === "serve status --json") {
        return Promise.resolve({ spawned: true, code: state.serveStatusCode ?? 0, stdout: JSON.stringify(state.serve), stderr: "" });
      }
      if (args.includes("--bg")) {
        if ((state.bgCode ?? 0) !== 0) return Promise.resolve({ spawned: true, code: state.bgCode, stdout: "", stderr: "serve write failed" });
        const hp = hostPort();
        state.serve.Web = state.serve.Web ?? {};
        state.serve.Web[hp] = state.serve.Web[hp] ?? { Handlers: {} };
        state.serve.Web[hp].Handlers[setPathOf(args)] = { Proxy: args[args.length - 1] };
        return Promise.resolve(cmdOk(""));
      }
      if (args[args.length - 1] === "off") {
        // Like the real CLI, `serve … off` addresses the node's CURRENT
        // hostname (honoring --https=<port>); it cannot remove a mapping
        // stored under a pre-rename hostname.
        const httpsArg = args.find((a) => a.startsWith("--https="));
        const port = httpsArg ? httpsArg.slice("--https=".length) : "443";
        const host = `${(state.status.Self?.DNSName ?? "").replace(/\.$/, "")}:${port}`;
        const web = state.serve.Web?.[host];
        if (web?.Handlers) {
          delete web.Handlers[setPathOf(args)];
          if (Object.keys(web.Handlers).length === 0) delete state.serve.Web[host];
        }
        return Promise.resolve(cmdOk(""));
      }
      throw new Error(`unmodeled tailscale command: ${sub}`);
    },
    probe: (url) => {
      if (url.includes("/__router/status")) return Promise.resolve(state.routerProbe ?? { reachable: false, status: null });
      // Only the injected non-loopback addresses answer as "external"; the served
      // tailnet https URL and loopback /auth/me both model the box (state.probe).
      for (const addr of state.networkAddresses ?? []) {
        if (url.includes(addr)) return Promise.resolve(state.externalProbe ?? { reachable: false, status: null });
      }
      return Promise.resolve(state.probe ?? { reachable: false, status: null });
    },
    networkInterfaces: () => state.networkAddresses ?? [],
  };
  return { deps, calls };
}

// Non-interactive I/O: `--no-wait`. Never blocks on a prompt.
const noWaitIo = { interactive: false, log: () => {}, waitForContinue: () => Promise.resolve() };
```

## `classifyAuthPosture`: strict match on callback-box's `/auth/me` shapes

A `{error:…}` 401 or an authenticated-user body (email + isOwner + boxes) ⇒
enforced. A generic 401, random JSON with only an `email`, an unparseable body,
a 503, or `{open:true}` are each refused (open / ambiguous) — a generic proxy or
unrelated service never passes as a protected callback-box.

```ts
[
  classifyAuthPosture({ reachable: false, status: null }),
  classifyAuthPosture(enforced401),
  classifyAuthPosture({ reachable: true, status: 401, body: "Unauthorized" }),
  classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ open: true }) }),
  classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ email: "a@b.c", isOwner: true, boxes: [] }) }),
  classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ email: "a@b.c" }) }),
  classifyAuthPosture({ reachable: true, status: 200, body: "not json" }),
  classifyAuthPosture({ reachable: true, status: 503, body: "" }),
]
=> [
  "unreachable",
  "enforced",
  "ambiguous",
  "open",
  "enforced",
  "ambiguous",
  "ambiguous",
  "ambiguous"
]
```

## Setup happy path: probe → configure → re-verify → record intent

Serve unconfigured, auth enforced: setup configures serve, re-verifies to
`ready`, records the exposure entry, and reports the working URL.

```ts
const state = { status: runningStatus, serve: {}, probe: enforced401 };
const sim = makeServeSim(state);
const result = await runTailscaleSetup(sim.deps, { target: "3210", io: noWaitIo });
[result.ok, result.message.includes("https://box.tail1234.ts.net/")]
=> [
  true,
  true
]
```

```ts continue
// Serve now fronts loopback:3210 on the node's host:443.
state.serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy
=> http://127.0.0.1:3210

// The exposure intent was recorded with port + dnsName.
const entry = loadExposureFile().targets.find((t) => t.port === 3210);
[entry?.port, entry?.dnsName]
=> [
  3210,
  "box.tail1234.ts.net"
]
```

## Funnel is NEVER enabled by setup

Setup issues no `funnel` command and writes no `AllowFunnel`.

```ts continue
sim.calls.some((c) => c.includes("funnel"))
=> false

JSON.stringify(state.serve).includes("Funnel")
=> false
```

## F1: intent is recorded BEFORE the serve write (survives a mid-write failure)

If the `tailscale serve` write fails AFTER intent is recorded, the intent STAYS
(over-recording is the fail-closed direction — the startup guard/stop heals it).

```ts
const state = { status: runningStatus, serve: {}, probe: enforced401, bgCode: 1 };
const sim = makeServeSim(state);
const result = await runTailscaleSetup(sim.deps, { target: "3230", io: noWaitIo });
[
  result.ok,                                              // the serve write failed
  sim.calls.some((c) => c.includes("--bg")),             // it WAS attempted
  loadExposureFile().targets.some((t) => t.port === 3230), // yet intent is recorded (fail closed)
]
=> [
  false,
  true,
  true
]
```

## Idempotent: a second run reaches the same state, no duplicate intent

```ts
const state = { status: runningStatus, serve: {}, probe: enforced401 };
const sim = makeServeSim(state);
await runTailscaleSetup(sim.deps, { target: "3211", io: noWaitIo });
const first = await runTailscaleSetup(sim.deps, { target: "3211", io: noWaitIo });
[first.ok, loadExposureFile().targets.filter((t) => t.port === 3211).length]
=> [
  true,
  1
]
```

## Preserve unrelated serve mappings

A pre-existing foreign mapping (another service on host:8443) survives setup;
the new host:443 mapping is added alongside it.

```ts
const foreign = {
  Web: { "box.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } } } },
};
const state = { status: runningStatus, serve: foreign, probe: enforced401 };
const sim = makeServeSim(state);
await runTailscaleSetup(sim.deps, { target: "3212", io: noWaitIo });
[
  state.serve.Web?.["box.tail1234.ts.net:8443"]?.Handlers?.["/"]?.Proxy,
  state.serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy,
]
=> [
  "http://127.0.0.1:5000",
  "http://127.0.0.1:3212"
]
```

## Guard: refuse to expose an OPEN (unauthenticated) box

The loopback `/auth/me` probe reports `{ open: true }` — setup refuses, never
issues a serve command, and records no intent.

```ts
const state = {
  status: runningStatus,
  serve: {},
  probe: { reachable: true, status: 200, body: JSON.stringify({ open: true }) },
};
const sim = makeServeSim(state);
const result = await runTailscaleSetup(sim.deps, { target: "3220", io: noWaitIo });
[
  result.ok,
  result.message.includes("UNAUTHENTICATED"),
  sim.calls.some((c) => c.includes("--bg")),
  loadExposureFile().targets.some((t) => t.port === 3220),
]
=> [
  false,
  true,
  false,
  false
]
```

## Guard: refuse on an unreachable, ambiguous, generic-401, or random-JSON probe

```ts
const unreachable = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
const r1 = await runTailscaleSetup(unreachable.deps, { target: "3221", io: noWaitIo });

const generic401 = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: true, status: 401, body: "Unauthorized" } });
const r2 = await runTailscaleSetup(generic401.deps, { target: "3222", io: noWaitIo });

const randomEmail = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: true, status: 200, body: JSON.stringify({ email: "x" }) } });
const r3 = await runTailscaleSetup(randomEmail.deps, { target: "3223", io: noWaitIo });

[r1.ok, r1.message.includes("nothing answered"), r2.ok, r3.ok, r2.message.includes("recognizable"), r3.message.includes("recognizable")]
=> [
  false,
  true,
  false,
  false,
  true,
  true
]
```

## Guard: refuse the dev router as a target (router-shape rejection)

If `/__router/status` answers with the dev router's status JSON, setup refuses —
the router fronts every worktree and is never a valid Tailscale target.

```ts
const state = {
  status: runningStatus,
  serve: {},
  probe: enforced401,
  routerProbe: { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, routerPid: 1, idleTimeoutMs: 1, worktrees: {} }) },
};
const sim = makeServeSim(state);
const result = await runTailscaleSetup(sim.deps, { target: "3210", io: noWaitIo });
[result.ok, result.message.includes("dev router"), sim.calls.some((c) => c.includes("--bg"))]
=> [
  false,
  true,
  false
]
```

## Guard: refuse a server that also answers on a non-loopback interface

The same port answers on `10.0.0.5` — the server is bound to a public interface,
not 127.0.0.1 only. Refuse before exposing it further.

```ts
const state = {
  status: runningStatus,
  serve: {},
  probe: enforced401,
  networkAddresses: ["10.0.0.5"],
  externalProbe: { reachable: true, status: 401, body: JSON.stringify({ error: "x" }) },
};
const sim = makeServeSim(state);
const result = await runTailscaleSetup(sim.deps, { target: "3240", io: noWaitIo });
[result.ok, result.message.includes("10.0.0.5"), loadExposureFile().targets.some((t) => t.port === 3240)]
=> [
  false,
  true,
  false
]
```

## `--no-wait` at a human-action state: print and exit nonzero

At `needs-login` (a human step) with `--no-wait`, setup prints the instruction
and returns a failing result rather than waiting.

```ts
const logged = [];
const io = { interactive: false, log: (l) => logged.push(l), waitForContinue: () => Promise.resolve() };
const sim = makeServeSim({ status: { BackendState: "NeedsLogin", Self: null, CertDomains: null }, serve: {}, probe: { reachable: false, status: null } });
const result = await runTailscaleSetup(sim.deps, { target: "3224", io });
[result.ok, logged.some((l) => l.startsWith("Next:")), result.message.includes("re-run")]
=> [
  false,
  true,
  true
]
```

## Interactive wait: do the human step, loop advances to the URL

With a TTY, setup waits at `needs-login`; when the operator completes the step
(here the fake flips the backend to `Running`), the loop advances to success.

```ts
const state = { status: { BackendState: "NeedsLogin", Self: null, CertDomains: null }, serve: {}, probe: enforced401 };
const sim = makeServeSim(state);
const io = {
  interactive: true,
  log: () => {},
  waitForContinue: () => { state.status = runningStatus; return Promise.resolve(); },
};
const result = await runTailscaleSetup(sim.deps, { target: "3225", io });
[result.ok, result.message.includes("https://box.tail1234.ts.net/")]
=> [
  true,
  true
]
```

## Stop: remove only this target's mapping, preserve others, clear intent

Set up two mappings (foreign on :8443, ours on :443 via setup), then stop ours.

```ts
const foreign = {
  Web: { "box.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } } } },
};
const state = { status: runningStatus, serve: foreign, probe: enforced401 };
const sim = makeServeSim(state);
await runTailscaleSetup(sim.deps, { target: "3226", io: noWaitIo });
const stop = await runTailscaleStop(sim.deps, { target: "3226" });
[
  stop.ok,
  state.serve.Web?.["box.tail1234.ts.net:443"], // our mapping gone
  state.serve.Web?.["box.tail1234.ts.net:8443"]?.Handlers?.["/"]?.Proxy, // foreign preserved
  loadExposureFile().targets.some((t) => t.port === 3226), // intent cleared
]
=> [
  true,
  null,
  "http://127.0.0.1:5000",
  false
]
```

## F6: stop tears down the target's path only, not a hardcoded `/`

The target is mapped at `/foo` on :443 alongside an UNRELATED `/` handler
(a different port). Stop removes `/foo` and leaves `/` untouched.

```ts
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
const stop = await runTailscaleStop(sim.deps, { target: "3250" });
[
  stop.ok,
  sim.calls.includes("tailscale serve --https=443 --set-path=/foo off"), // exactly /foo
  sim.calls.includes("tailscale serve --https=443 --set-path=/ off"),    // NOT /
  serve.Web?.["box.tail1234.ts.net:443"]?.Handlers?.["/"]?.Proxy,         // / preserved
  Object.keys(serve.Web?.["box.tail1234.ts.net:443"]?.Handlers ?? {}).join(","), // only / remains
]
=> [
  true,
  true,
  false,
  "http://127.0.0.1:5000",
  "/"
]
```

## Stop scans EVERY host: a pre-rename mapping keeps the guard armed

A mapping created before a node rename lives under the OLD hostname (here also
a non-443 serve port) and still fronts the target. Stop finds it by scanning
every Web host for the loopback port — but the real CLI's `serve … off` only
addresses the current hostname, so the stale mapping survives the readback.
The proof therefore FAILS: intent is kept and stop reports the survivor.
(Without the every-host scan, stop would clear the guard while that mapping
stays live — the fail-open shape of findings 1-2.)

```ts
const serve = {
  Web: {
    "old-name.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3260" } } },
    "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3260" } } },
  },
};
const sim = makeServeSim({ status: runningStatus, serve, probe: enforced401 });
await recordExposure({ port: 3260, dnsName: "box.tail1234.ts.net" });
const stop = await runTailscaleStop(sim.deps, { target: "3260" });
[
  stop.ok,                                                              // proof failed: fail closed
  stop.message.includes("still present"),
  sim.calls.includes("tailscale serve --https=8443 --set-path=/ off"), // teardown attempted old mapping
  sim.calls.includes("tailscale serve --https=443 --set-path=/ off"),  // current mapping torn down
  Object.keys(serve.Web ?? {}).join(","),                               // stale host survives
  loadExposureFile().targets.some((t) => t.port === 3260),              // guard KEPT
]
=> [
  false,
  true,
  true,
  true,
  "old-name.tail1234.ts.net:8443",
  true
]
```

```ts cleanup
await clearExposure(3260);
```

## F2: stop KEEPS the intent when removal can't be proven (tailscale absent)

Intent is recorded, then `tailscale` is unavailable — stop cannot prove the
mapping is gone, so it keeps the intent (fail closed) and exits nonzero.

```ts
await recordExposure({ port: 3260, dnsName: "box.tail1234.ts.net" });
const sim = makeServeSim({ status: runningStatus, serve: {}, probe: enforced401, binaryPresent: false });
const stop = await runTailscaleStop(sim.deps, { target: "3260" });
[stop.ok, stop.message.includes("KEEPING"), loadExposureFile().targets.some((t) => t.port === 3260)]
=> [
  false,
  true,
  true
]
```

## Stop when nothing is configured is a clean no-op (exit 0)

```ts
const sim = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
const stop = await runTailscaleStop(sim.deps, { target: "3299" });
[stop.ok, stop.message.includes("nothing to stop")]
=> [
  true,
  true
]
```

## F7: the exposure RMW takes the project file lock (cross-process mutual exclusion)

While another process holds the exposure lock, `recordExposure` refuses (fail
closed — it can't interleave its read-modify-write and lose an entry); once the
lock is released the write succeeds.

```ts
const lockPath = `${process.env.CB_TAILSCALE_EXPOSURE_FILE}.lock`;
await acquireLock(lockPath, { op: "other-process" });
let blockedName = "";
try {
  await recordExposure({ port: 4001, dnsName: "a.ts.net" });
} catch (e) {
  blockedName = e.name;
}
await releaseLock(lockPath);
await recordExposure({ port: 4002, dnsName: "b.ts.net" });
[blockedName, loadExposureFile().targets.some((t) => t.port === 4001), loadExposureFile().targets.some((t) => t.port === 4002)]
=> [
  "LockHeldError",
  false,
  true
]
```

```ts cleanup
fs.rmSync(process.env.CB_TAILSCALE_EXPOSURE_FILE, { force: true });
fs.rmSync(`${process.env.CB_TAILSCALE_EXPOSURE_FILE}.lock`, { force: true });
delete process.env.CB_TAILSCALE_EXPOSURE_FILE;
```
