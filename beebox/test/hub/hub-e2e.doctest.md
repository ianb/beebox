# `bbx hub` end-to-end: real child process, `/healthz`, clean teardown (Track D, chunk D1)

The seam tests (`hub-router.doctest.md`, `hub-config.doctest.md`) carry the
real coverage — this one is deliberately lean: build one real v2 fixture
box (the same symlink trick `scaffoldPackageRoot`/`test/cli/lib/init-v2.doctest.md`
use to make a fixture box loadable without a real `pnpm install`, plus a
`node_modules/.bin/bbx` symlink so the supervisor's own "spawn the box's own
installed `bbx`" path has something to spawn), start the hub against it for
real, wait for `/healthz` to report the box running, fetch through the hub,
then SIGTERM the hub and assert the child actually died (no orphans — this
repo cares about that specifically, see `workstreams-app/src/router/router.ts`'s orphan-resistance
doc).

Spawns a real `bbx hub` subprocess and a real `bbx serve` grandchild, so this
is slow (seconds, not milliseconds) — that's the tradeoff for "real",
deliberately confined to this one test.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { t as tap } from "tap";
import { detectBoxTarget, scaffoldPackageRoot } from "../../src/core/box/package.js";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality } from "../../src/core/box/index.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { signSession } from "../../src/webapp/auth.js";

const execFileP = promisify(execFile);

// This file builds the CLI and boots two real processes. Under parallel suite
// load that setup can exceed the suite's default five-minute per-file timeout.
tap.setTimeout(600_000);

const STARTUP_TIMEOUT_MS = 120_000;

// Auth is always-on now — there is no open-mode opt-out anymore, so the spawned
// `bbx hub` always enforces the wall. This e2e therefore authenticates for real:
// a session cookie signed with the shared BBX_SESSION_SECRET the hub inherits.
// The hub verifies the cookie (it holds the session secret) and injects the
// gated `x-bbx-authenticated-email` header to the child; the child authorizes it
// via `canAccessBox` against BBX_OWNER_EMAIL (which the child inherits, but the
// session secret deliberately does NOT — see child-env.ts). BBX_AUTH_FILE points
// at a nonexistent path so the hub's cookie resolution reads no real local store
// (a gen-less cookie for an email with no record is a valid Google-only-style
// identity — source "cookie").
process.env.BBX_SESSION_SECRET = "test-session-secret-for-hub-e2e-doctest";
process.env.BBX_OWNER_EMAIL = "owner@example.com";
process.env.BBX_AUTH_FILE = path.join(os.tmpdir(), "bbx-hub-e2e-nonexistent-auth.json");
const ownerCookie = `bbx_session=${signSession({ email: "owner@example.com", name: "Owner" })}`;
// The hub's /healthz is diag-key-gated; the spawned hub inherits this env.
const DIAG_KEY = "test-diag-key-for-e2e-doctest";
process.env.BBX_DIAG_API_KEY = DIAG_KEY;
const diagAuth = { headers: { authorization: `Bearer ${DIAG_KEY}` } };

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

async function waitFor(check, { timeoutMs, intervalMs, label }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Name what was being awaited. A bare "timed out" is reported against the
  // enclosing test's FIRST block (the CLI build, line 116) because every step
  // below shares one test via `continue`, so without a label the diagnostic
  // points at code that already succeeded.
  throw new Error(`waitFor: timed out after ${timeoutMs}ms waiting for ${label}`);
}

/**
 * Claim a currently-free loopback port for the hub.
 *
 * The hub otherwise falls back to `DEFAULT_HUB_PORT` (4310), and several
 * worktree sessions run `pnpm test` concurrently on one machine as a matter of
 * course — so two runs would fight over one port and the loser would hang for
 * the full startup timeout. Nothing this test proves needs a well-known port.
 *
 * Binding then closing leaves a small window before the hub binds; that is
 * acceptable only because the readiness wait below now fails immediately, with
 * the hub's own output, when the hub exits instead of listening.
 */
async function pickFreePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error("no ephemeral port available"))));
    });
  });
}

/** Same fixture recipe as test/cli/lib/init-v2.doctest.md's `fullInit`,
 *  trimmed to what a served box actually needs (skips validation hooks and
 *  git -- irrelevant to HTTP serving), plus the `node_modules/.bin/bbx`
 *  symlink the supervisor looks for (a real `pnpm install` would populate
 *  this; scaffoldPackageRoot only symlinks `node_modules/beebox`
 *  itself, matching the plan's F1 "no real install yet" note). */
async function makeV2Fixture() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-hub-e2e-"));
  const { boxRoot, packageRoot } = await detectBoxTarget(target);
  await scaffoldPackageRoot(packageRoot);
  await initBox(boxRoot, { skipGit: true, branch: "main" });
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);

  const binDir = path.join(packageRoot, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.symlink(path.join(PACKAGE_ROOT, "bin", "bbx"), path.join(binDir, "bbx"));

  return { target, boxRoot, packageRoot };
}
```

Rebuild the CLI bundle once, up front, outside the timed readiness wait
below — the fixture's `node_modules/.bin/bbx` resolves (through the
`node_modules/beebox` symlink) to THIS checkout's real `bin/bbx`,
which self-heals a stale bundle by rebuilding before running; without a
fresh bundle here, that rebuild would eat into the supervisor's own
readiness timeout instead of happening once, up front, on our terms.

The built **frontend** is a second undeclared dependency: the
traffic-reaches-the-child probe below rides the SPA fallback, which
serves `src/frontend/dist/index.html` — a file no dev worktree has
(Vite serves the frontend live; only deploys run the production build).
Build it once if absent; when present (CI, a prior run) this is a stat
call. It is deliberately not rebuilt when stale — this test proves
routing, not frontend freshness:

```ts
await execFileP("node", ["scripts/build-cli.ts"], { cwd: PACKAGE_ROOT });

const frontendIndex = path.join(PACKAGE_ROOT, "src/frontend/dist/index.html");
const frontendBuilt = await fs.access(frontendIndex).then(() => true, () => false);
if (!frontendBuilt) {
  await execFileP("pnpm", ["run", "build:frontend"], { cwd: PACKAGE_ROOT });
}
```

## The hub starts the box, `/healthz` reports it running, and traffic reaches it

```ts continue
const fixture = await makeV2Fixture();
const hubConfigPath = path.join(fixture.target, "..", `hub-e2e-config-${path.basename(fixture.target)}.json`);
const requestedPort = await pickFreePort();
await fs.writeFile(
  hubConfigPath,
  JSON.stringify({ port: requestedPort, boxes: { fixture: { path: fixture.packageRoot } } }, null, 2)
);

const hubBin = path.join(PACKAGE_ROOT, "bin", "bbx");
const hubProcess = execFile(hubBin, ["hub", "--config", hubConfigPath], { cwd: PACKAGE_ROOT });
let hubStdout = "";
let hubStderr = "";
let hubExited = null;
hubProcess.stdout.on("data", (d) => (hubStdout += d.toString()));
hubProcess.stderr.on("data", (d) => (hubStderr += d.toString()));
hubProcess.on("exit", (code, signal) => (hubExited = `code=${code} signal=${signal}`));

const hubPort = await waitFor(() => {
  // A hub that cannot bind exits within milliseconds. Waiting out the full
  // startup timeout for it teaches nothing and hides the cause: the hub's own
  // stderr names the port conflict, and nothing surfaced it before.
  if (hubExited !== null) {
    throw new Error(
      `hub exited before it listened (${hubExited})\n--- hub stdout ---\n${hubStdout}\n--- hub stderr ---\n${hubStderr}`,
    );
  }
  const m = /Hub running at http:\/\/127\.0\.0\.1:(\d+)/.exec(hubStdout);
  return m ? Number(m[1]) : null;
}, { timeoutMs: STARTUP_TIMEOUT_MS, intervalMs: 200, label: "the hub to report its listening port" });

// Also the assertion that `hub.json`'s `port` is honored at all.
hubPort === requestedPort
=> true

const health = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${hubPort}/healthz`, diagAuth);
  const body = await res.json();
  const box = body.boxes.find((b) => b.slug === "fixture");
  return box && box.status === "running" ? box : null;
}, { timeoutMs: STARTUP_TIMEOUT_MS, intervalMs: 300, label: "the fixture box to report status=running via /healthz" });

health.status
=> running

// `/healthz`'s per-box status is derived from supervisor state, not the raw
// process, so read the child's own pid file to prove it's a real running
// process — `bbx serve` writes `.bbx-serve.pid` into the box root.
const childPid = Number((await fs.readFile(path.join(fixture.boxRoot, ".bbx-serve.pid"), "utf-8")).trim());
Number.isInteger(childPid) && childPid > 0
=> true

health.consecutiveFailures
=> 0
```

The diag-gated canary cold-starts a box and confirms it serves — the deploy's
child-level check. The fixture box is already running here, so `ensureRunning`
resolves immediately and the canary reports it ready.

```ts continue
const canaryRes = await fetch(`http://127.0.0.1:${hubPort}/healthz/canary`, diagAuth);
const canaryBody = await canaryRes.json();
JSON.stringify({ status: canaryRes.status, box: canaryBody.status, slug: canaryBody.slug })
=> {"status":200,"box":"ok","slug":"fixture"}
```

Traffic actually reaches the box through the hub (its own Fastify instance
serves itself at `/fixture/...`, same as standalone `bbx serve --slug`). The
box's `/healthz` is root-level, not under its slug prefix (see
`server-root.ts`'s `registerRootInfoRoutes`) -- an unmatched path under
`/fixture/...` falls through to the box's own SPA fallback, so hitting one
still proves the request reached the CHILD process, not the hub answering
on its own behalf:

```ts continue
const proxied = await fetch(`http://127.0.0.1:${hubPort}/fixture/some-client-route`, {
  headers: { cookie: ownerCookie },
});
proxied.status
=> 200

const proxiedBody = await proxied.text();
proxiedBody.toLowerCase().includes("<!doctype html>")
=> true
```

## SIGTERM kills the hub AND its child -- no orphan

```ts continue
hubProcess.kill("SIGTERM");
await waitFor(() => (pidAlive(hubProcess.pid) ? null : true), { timeoutMs: 5000, intervalMs: 100, label: "the hub process to exit after SIGTERM" });
await waitFor(() => (pidAlive(childPid) ? null : true), { timeoutMs: 5000, intervalMs: 100, label: "the bbx serve child to exit with its hub" });

pidAlive(hubProcess.pid)
=> false

pidAlive(childPid)
=> false
```

```ts cleanup
// The SIGTERM section above is an assertion, not a teardown: any failure before
// it leaves this hub — and the `bbx serve` grandchild it supervises — running and
// holding the port. One such orphan sat on 4310 for 25 minutes on 2026-08-14 and
// made every later run in every worktree look like a regression. SIGTERM first
// so the hub stops its own child; SIGKILL only if it will not go.
if (hubProcess.pid !== undefined && pidAlive(hubProcess.pid)) {
  hubProcess.kill("SIGTERM");
  await waitFor(() => (pidAlive(hubProcess.pid) ? null : true), {
    timeoutMs: 5000,
    intervalMs: 100,
    label: "the hub to exit during cleanup",
  }).catch(() => hubProcess.kill("SIGKILL"));
}
await fs.rm(fixture.target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await fs.rm(hubConfigPath, { force: true });
```
