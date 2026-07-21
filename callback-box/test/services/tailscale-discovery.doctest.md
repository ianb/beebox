# Tailscale target auto-discovery

`--target <port>` is optional. When omitted, `resolveTargetOrDiscover` reads the
hub config (`~/.config/cb/hub.json`) and exposes that hub's loopback port;
explicit `--target` always wins; and with neither an explicit port nor a
discoverable hub config it REFUSES with guidance rather than guessing (the dev
router is never auto-targeted). Discovery only supplies a candidate port — every
posture guard in `tailscale-target.ts` still decides whether it may be exposed.
See `docs/implemented-plans/tailscale-expose-and-protect.md` Track B.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { resolveTargetOrDiscover } from "../../src/services/tailscale-discovery.js";
import { createFakeTailscaleDeps } from "../../src/services/tailscale-fake.js";
import { runTailscaleSetup } from "../../src/services/tailscale-setup.js";

// Scope the exposure file to this run (setup's guard test never records, but
// keep it hermetic regardless).
process.env.CB_TAILSCALE_EXPOSURE_FILE = path.join(
  os.tmpdir(),
  `cb-exposure-discovery-test-${process.pid}-${Date.now()}.json`,
);

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cb-discovery-"));

// Write a hub.json into a temp dir and return its path (injected as the
// discovery source in place of ~/.config/cb/hub.json).
async function writeHub(name, obj) {
  const p = path.join(tmp, name);
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
  return p;
}

// Capture the discovery announcement lines.
function capturing() {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
}

const runningStatus = {
  BackendState: "Running",
  Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  CertDomains: ["box.tail1234.ts.net"],
};

const noWaitIo = { interactive: false, log: () => {}, waitForContinue: () => Promise.resolve() };
```

## Omitting `--target` auto-detects the hub's port

A hub config with an explicit `port` yields that port, and the announcement
names what was discovered.

```ts
const hubPath = await writeHub("hub.json", { port: 5321, boxes: {} });
const cap = capturing();
const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: hubPath, log: cap.log });
[r.ok, r.ok ? r.target.port : null, cap.lines.some((l) => l.includes("Discovered hub") && l.includes("5321"))]
=> [
  true,
  5321,
  true
]
```

A hub config that omits `port` falls back to the hub default (4310), not the
standalone `cb serve` default (3210):

```ts
const hubPath = await writeHub("hub-noport.json", { boxes: {} });
const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: hubPath, log: () => {} });
[r.ok, r.ok ? r.target.port : null]
=> [
  true,
  4310
]
```

## Explicit `--target` overrides a present hub config

Even with a hub config present (port 5321), an explicit `--target` wins and the
config is not consulted (no announcement).

```ts
const hubPath = await writeHub("hub-override.json", { port: 5321, boxes: {} });
const cap = capturing();
const r = await resolveTargetOrDiscover({ target: "7777", hubConfigPath: hubPath, log: cap.log });
[r.ok, r.ok ? r.target.port : null, cap.lines.length]
=> [
  true,
  7777,
  0
]
```

An explicit but invalid `--target` is refused (it never falls through to
discovery):

```ts
const hubPath = await writeHub("hub-invalid.json", { port: 5321, boxes: {} });
const r = await resolveTargetOrDiscover({ target: "not-a-port", hubConfigPath: hubPath, log: () => {} });
[r.ok, r.ok ? null : r.message.includes("invalid --target")]
=> [
  false,
  true
]
```

## No `--target` and no hub config: refuse, never guess

A missing (or unreadable) hub config is "no hub to discover" — we do NOT guess a
port; we refuse and tell the operator to pass `--target`.

```ts
const missing = path.join(tmp, "does-not-exist.json");
const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: missing, log: () => {} });
[r.ok, r.ok ? null : r.message.includes("no hub config found"), r.ok ? null : r.message.includes("--target <port>")]
=> [
  false,
  true,
  true
]
```

An invalid hub config (malformed JSON) is likewise treated as "no hub", not a
propagated load error:

```ts
const badPath = path.join(tmp, "bad.json");
await fs.writeFile(badPath, "{ not json");
const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: badPath, log: () => {} });
[r.ok, r.ok ? null : r.message.includes("auto-detect a port")]
=> [
  false,
  true
]
```

## A discovered port still runs the posture guards

Discovery only supplies a candidate port. If the discovered port turns out to be
the dev router (its `/__router/status` answers), setup still REFUSES via the
router guard — auto-detection never bypasses the fail-closed classification.

```ts
const hubPath = await writeHub("hub-router.json", { port: 3210, boxes: {} });
const discovered = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: hubPath, log: () => {} });
const deps = createFakeTailscaleDeps({
  status: runningStatus,
  serve: {},
  probe: { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, worktrees: {} }) },
});
const result = discovered.ok
  ? await runTailscaleSetup(deps, { target: discovered.target, io: noWaitIo })
  : { ok: false, message: discovered.message };
[discovered.ok, result.ok, result.message.includes("dev router")]
=> [
  true,
  false,
  true
]
```

```ts cleanup
await fs.rm(tmp, { recursive: true, force: true });
await fs.rm(process.env.CB_TAILSCALE_EXPOSURE_FILE, { force: true });
delete process.env.CB_TAILSCALE_EXPOSURE_FILE;
```
