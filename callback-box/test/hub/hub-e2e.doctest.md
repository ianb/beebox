# `cb hub` end-to-end: real child process, `/healthz`, clean teardown (Track D, chunk D1)

The seam tests (`hub-router.doctest.md`, `hub-config.doctest.md`) carry the
real coverage — this one is deliberately lean: build one real v2 fixture
box (the same symlink trick `scaffoldPackageRoot`/`test/cli/lib/init-v2.doctest.md`
use to make a fixture box loadable without a real `pnpm install`, plus a
`node_modules/.bin/cb` symlink so the supervisor's own "spawn the box's own
installed `cb`" path has something to spawn), start the hub against it for
real, wait for `/healthz` to report the box running, fetch through the hub,
then SIGTERM the hub and assert the child actually died (no orphans — this
repo cares about that specifically, see `bin/router.ts`'s orphan-resistance
doc).

Spawns a real `cb hub` subprocess and a real `cb serve` grandchild, so this
is slow (seconds, not milliseconds) — that's the tradeoff for "real",
deliberately confined to this one test.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectBoxTarget, scaffoldPackageRoot } from "../../src/core/box/package.js";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality } from "../../src/core/box/index.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

const execFileP = promisify(execFile);

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

async function waitFor(check, { timeoutMs, intervalMs }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor: timed out");
}

/** Same fixture recipe as test/cli/lib/init-v2.doctest.md's `fullInit`,
 *  trimmed to what a served box actually needs (skips validation hooks and
 *  git -- irrelevant to HTTP serving), plus the `node_modules/.bin/cb`
 *  symlink the supervisor looks for (a real `pnpm install` would populate
 *  this; scaffoldPackageRoot only symlinks `node_modules/callback-box`
 *  itself, matching the plan's F1 "no real install yet" note). */
async function makeV2Fixture() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "cb-hub-e2e-"));
  const { boxRoot, packageRoot } = await detectBoxTarget(target);
  await scaffoldPackageRoot(packageRoot);
  await initBox(boxRoot, { skipGit: true, branch: "main" });
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);

  const binDir = path.join(packageRoot, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.symlink(path.join(PACKAGE_ROOT, "bin", "cb"), path.join(binDir, "cb"));

  return { target, boxRoot, packageRoot };
}
```

Rebuild the CLI bundle once, up front, outside the timed readiness wait
below — the fixture's `node_modules/.bin/cb` resolves (through the
`node_modules/callback-box` symlink) to THIS checkout's real `bin/cb`,
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
await execFileP("node", ["scripts/build-cli.mjs"], { cwd: PACKAGE_ROOT });

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
await fs.writeFile(
  hubConfigPath,
  JSON.stringify({ boxes: { fixture: { path: fixture.packageRoot } } }, null, 2)
);

const hubBin = path.join(PACKAGE_ROOT, "bin", "cb");
const hubProcess = execFile(hubBin, ["hub", "--config", hubConfigPath], { cwd: PACKAGE_ROOT });
let hubStdout = "";
hubProcess.stdout.on("data", (d) => (hubStdout += d.toString()));

const hubPort = await waitFor(() => {
  const m = /Hub running at http:\/\/127\.0\.0\.1:(\d+)/.exec(hubStdout);
  return m ? Number(m[1]) : null;
}, { timeoutMs: 30000, intervalMs: 200 });

const health = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${hubPort}/healthz`);
  const body = await res.json();
  const box = body.boxes.find((b) => b.slug === "fixture");
  return box && box.status === "running" ? box : null;
}, { timeoutMs: 30000, intervalMs: 300 });

health.status
=> running

// The hub's public /healthz was reviewed down to liveness + open (no per-box
// runtime detail like pid), so read the child's own pid file to prove it's a
// real running process — `cb serve` writes `.cb-serve.pid` into the box root.
const childPid = Number((await fs.readFile(path.join(fixture.boxRoot, ".cb-serve.pid"), "utf-8")).trim());
Number.isInteger(childPid) && childPid > 0
=> true
```

Traffic actually reaches the box through the hub (its own Fastify instance
serves itself at `/fixture/...`, same as standalone `cb serve --slug`). The
box's `/healthz` is root-level, not under its slug prefix (see
`server-root.ts`'s `registerRootInfoRoutes`) -- an unmatched path under
`/fixture/...` falls through to the box's own SPA fallback, so hitting one
still proves the request reached the CHILD process, not the hub answering
on its own behalf:

```ts continue
const proxied = await fetch(`http://127.0.0.1:${hubPort}/fixture/some-client-route`);
proxied.status
=> 200

const proxiedBody = await proxied.text();
proxiedBody.toLowerCase().includes("<!doctype html>")
=> true
```

## SIGTERM kills the hub AND its child -- no orphan

```ts continue
hubProcess.kill("SIGTERM");
await waitFor(() => (pidAlive(hubProcess.pid) ? null : true), { timeoutMs: 5000, intervalMs: 100 });
await waitFor(() => (pidAlive(childPid) ? null : true), { timeoutMs: 5000, intervalMs: 100 });

pidAlive(hubProcess.pid)
=> false

pidAlive(childPid)
=> false
```

```ts cleanup
await fs.rm(fixture.target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await fs.rm(hubConfigPath, { force: true });
```
