# Tailscale setup / stop (guided serve-config loop)

`cb tailscale setup` runs the chunk-1 status state machine as a guided loop: it
probes the target's auth posture over loopback and REFUSES to expose an open
(unauthenticated) box, then writes a persistent, path-scoped `tailscale serve`
mapping — preserving unrelated mappings, never enabling Funnel — re-verifies,
and records exposure intent. `cb tailscale stop` removes only that mapping and
clears the intent. Everything runs against a stateful fake that models
`tailscale serve`'s incremental semantics — no tailnet, no TTY. See
`docs/plans/tailscale-expose-and-protect.md` Track B chunk 2.

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  classifyAuthPosture,
  runTailscaleSetup,
  runTailscaleStop,
} from "../../src/services/tailscale-setup.js";
import { loadExposureFile } from "../../src/services/tailscale-exposure.js";

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

function cmdOk(stdout) {
  return { spawned: true, code: 0, stdout, stderr: "" };
}

// A stateful fake modeling `tailscale serve`'s incremental behavior: `--bg`
// adds/replaces the path-`/` handler on <host>:443 (preserving other hosts/paths);
// `… off` removes only that handler. `state.serve` is mutated in place so tests
// can inspect the resulting config.
function makeServeSim(state) {
  state.serve = state.serve ?? {};
  const calls = [];
  const hostPort = () => `${(state.status.Self?.DNSName ?? "").replace(/\.$/, "")}:443`;
  const deps = {
    run: (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      const sub = args.join(" ");
      if (sub === "status --json") return Promise.resolve(cmdOk(JSON.stringify(state.status)));
      if (sub === "serve status --json") return Promise.resolve(cmdOk(JSON.stringify(state.serve)));
      if (args.includes("--bg")) {
        const hp = hostPort();
        state.serve.Web = state.serve.Web ?? {};
        state.serve.Web[hp] = state.serve.Web[hp] ?? { Handlers: {} };
        state.serve.Web[hp].Handlers["/"] = { Proxy: args[args.length - 1] };
        return Promise.resolve(cmdOk(""));
      }
      if (args[args.length - 1] === "off") {
        const hp = hostPort();
        const web = state.serve.Web?.[hp];
        if (web?.Handlers) {
          delete web.Handlers["/"];
          if (Object.keys(web.Handlers).length === 0) delete state.serve.Web[hp];
        }
        return Promise.resolve(cmdOk(""));
      }
      return Promise.resolve(cmdOk(""));
    },
    probe: () => Promise.resolve(state.probe ?? { reachable: false, status: null }),
  };
  return { deps, calls };
}

// Non-interactive I/O: `--no-wait`. Never blocks on a prompt.
const noWaitIo = { interactive: false, log: () => {}, waitForContinue: () => Promise.resolve() };
```

## `classifyAuthPosture`: enforced vs open vs unreachable vs ambiguous

`{ open: true }` ⇒ open (refuse); a 401 or an authenticated user ⇒ enforced
(proceed); no response ⇒ unreachable; a 503 or unparseable body ⇒ ambiguous.

```ts
[
  classifyAuthPosture({ reachable: false, status: null }),
  classifyAuthPosture({ reachable: true, status: 401 }),
  classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ open: true }) }),
  classifyAuthPosture({ reachable: true, status: 200, body: JSON.stringify({ email: "a@example.com" }) }),
  classifyAuthPosture({ reachable: true, status: 200, body: "not json" }),
  classifyAuthPosture({ reachable: true, status: 503, body: "" }),
]
=> [
  "unreachable",
  "enforced",
  "open",
  "enforced",
  "ambiguous",
  "ambiguous"
]
```

## Setup happy path: probe → configure → re-verify → record intent

Serve unconfigured, auth enforced (401): setup configures serve, re-verifies to
`ready`, records the exposure entry, and reports the working URL.

```ts
const state = { status: runningStatus, serve: {}, probe: { reachable: true, status: 401 } };
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

Setup issues no `funnel` command and writes no `AllowFunnel` — "nothing publicly
exposed" is an invariant setup upholds.

```ts continue
sim.calls.some((c) => c.includes("funnel"))
=> false

JSON.stringify(state.serve).includes("Funnel")
=> false
```

## Idempotent: a second run reaches the same state, no duplicate intent

```ts
const state = { status: runningStatus, serve: {}, probe: { reachable: true, status: 401 } };
const sim = makeServeSim(state);
await runTailscaleSetup(sim.deps, { target: "3211", io: noWaitIo });
const first = await runTailscaleSetup(sim.deps, { target: "3211", io: noWaitIo });
// Second run finds serve already correct: succeeds without a duplicate entry.
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
const state = { status: runningStatus, serve: foreign, probe: { reachable: true, status: 401 } };
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

## Guard: refuse on an unreachable or ambiguous probe (fail closed, distinct)

```ts
const unreachable = makeServeSim({ status: runningStatus, serve: {}, probe: { reachable: false, status: null } });
const r1 = await runTailscaleSetup(unreachable.deps, { target: "3221", io: noWaitIo });

const garbage = makeServeSim({
  status: runningStatus,
  serve: {},
  probe: { reachable: true, status: 200, body: "<html>not json</html>" },
});
const r2 = await runTailscaleSetup(garbage.deps, { target: "3222", io: noWaitIo });

[r1.ok, r1.message.includes("nothing answered"), r2.ok, r2.message.includes("recognizable auth posture")]
=> [
  false,
  true,
  false,
  true
]
```

## `--no-wait` at a human-action state: print and exit nonzero

At `needs-login` (a human step) with `--no-wait`, setup prints the instruction
and returns a failing result rather than waiting.

```ts
const logged = [];
const io = { interactive: false, log: (l) => logged.push(l), waitForContinue: () => Promise.resolve() };
const sim = makeServeSim({ status: { BackendState: "NeedsLogin" }, serve: {}, probe: { reachable: false, status: null } });
const result = await runTailscaleSetup(sim.deps, { target: "3223", io });
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
const state = { status: { BackendState: "NeedsLogin" }, serve: {}, probe: { reachable: true, status: 401 } };
const sim = makeServeSim(state);
const io = {
  interactive: true,
  log: () => {},
  waitForContinue: () => { state.status = runningStatus; return Promise.resolve(); },
};
const result = await runTailscaleSetup(sim.deps, { target: "3224", io });
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
const state = { status: runningStatus, serve: foreign, probe: { reachable: true, status: 401 } };
const sim = makeServeSim(state);
await runTailscaleSetup(sim.deps, { target: "3225", io: noWaitIo });
const stop = await runTailscaleStop(sim.deps, { target: "3225" });
[
  stop.ok,
  state.serve.Web?.["box.tail1234.ts.net:443"], // our mapping gone
  state.serve.Web?.["box.tail1234.ts.net:8443"]?.Handlers?.["/"]?.Proxy, // foreign preserved
  loadExposureFile().targets.some((t) => t.port === 3225), // intent cleared
]
=> [
  true,
  null,
  "http://127.0.0.1:5000",
  false
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

```ts cleanup
fs.rmSync(process.env.CB_TAILSCALE_EXPOSURE_FILE, { force: true });
delete process.env.CB_TAILSCALE_EXPOSURE_FILE;
```
