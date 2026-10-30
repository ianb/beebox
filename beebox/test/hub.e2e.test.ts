// # `bbx hub` end-to-end: real child process, `/healthz`, clean teardown (Track D, chunk D1)
//
// The seam tests (`test/hub/server.router.test.ts`, `test/hub/config.test.ts`) carry the
// real coverage — this one is deliberately lean: build one real fixture box
// (the same symlink trick `scaffoldPackageRoot` uses to make a fixture box
// loadable without a real `pnpm install`; the supervisor's "spawn the box's own
// engine's `bbx`" path resolves through that same `node_modules/beebox` link),
// start the hub against it for real, wait for
// `/healthz` to report the box running, fetch through the hub, then SIGTERM
// the hub and assert the child actually died (no orphans — this repo cares
// about that specifically, see `workstreams-app/src/router/server/listener.ts`'s orphan-resistance
// doc).
//
// Spawns a real `bbx hub` subprocess and a real `bbx serve` grandchild, so this
// is slow (seconds, not milliseconds) — that's the tradeoff for "real",
// deliberately confined to this one test.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { promisify } from "node:util";
import { t as tap } from "tap";
import { detectBoxTarget, scaffoldPackageRoot } from "../src/core/box/package.js";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality } from "../src/core/box/structure/core.js";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";
import { signSession } from "../src/webapp/auth.js";
import { BOX_KILL_GRACE_MS } from "../src/hub/child-process-utils.js";

const execFileP = promisify(execFile);

// This file builds the CLI and boots two real processes. Under parallel suite
// load that setup can exceed the suite's default five-minute per-file timeout.
tap.setTimeout(600_000);

const STARTUP_TIMEOUT_MS = 120_000;
const SCHEMAS_DIR = "src/schemas";
const SCHEMA_ENV_PROBE = "schema-env-probe.json";

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
process.env.BBX_SESSION_SECRET = "test-session-secret-for-hub-e2e-test";
process.env.BBX_OWNER_EMAIL = "owner@example.com";
process.env.BBX_AUTH_FILE = path.join(os.tmpdir(), "bbx-hub-e2e-nonexistent-auth.json");
const ownerCookie = `bbx_session=${signSession({ email: "owner@example.com", name: "Owner" })}`;
// The hub's /healthz is diag-key-gated; the spawned hub inherits this env.
const DIAG_KEY = "test-diag-key-for-e2e-test";
process.env.BBX_DIAG_API_KEY = DIAG_KEY;
const diagAuth = { headers: { authorization: `Bearer ${DIAG_KEY}` } };

// Assigned below. Declared here so the cleanup block can read them even when
// a step fails before they are set: a `const` declared in a later block is in
// its temporal dead zone for cleanup, which then throws a ReferenceError that
// hides the real failure.
let fixture: { target: string; boxRoot: string } | null = null;
let hubConfigPath: string | null = null;
let hubProcess: ChildProcess | null = null;

/** The `/healthz` and `/healthz/canary` bodies, parsed for the fields read below. */
const healthzSchema = z.object({
  boxes: z.array(z.object({ slug: z.string(), status: z.string(), consecutiveFailures: z.number() })),
});
type BoxRow = z.infer<typeof healthzSchema>["boxes"][number];
const canarySchema = z.object({ status: z.string(), slug: z.string() }).strict();
const proxiedSchema = z.object({
  status: z.string(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), message: z.string(), severity: z.string() })),
}).strict();
type CheckRow = z.infer<typeof proxiedSchema>["checks"][number];

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

async function waitFor<T>(
  check: () => T | null | Promise<T | null>,
  { timeoutMs, intervalMs, label }: { timeoutMs: number; intervalMs: number; label: string | (() => string) },
): Promise<T> {
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
  const described = typeof label === "function" ? label() : label;
  throw new Error(`waitFor: timed out after ${timeoutMs}ms waiting for ${described}`);
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
async function pickFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error("no ephemeral port available"))));
    });
  });
}

/** Trimmed to what a served box actually needs (skips validation hooks). The
 *  supervisor spawns `<real path of node_modules/beebox>/bin/bbx`, and
 *  scaffoldPackageRoot's `node_modules/beebox` symlink is enough for that
 *  (the plan's F1 "no real install yet" note).
 *
 *  The box IS a Git repository, and that is not incidental: the hub's child
 *  spawn admits the box through `acquireBoxStartup`, whose gate lives in the
 *  Git directory. A `skipGit` fixture makes every start throw "Box maintenance
 *  requires a Git repository", which surfaces only as the readiness wait below
 *  timing out. */
async function makeFixtureBox() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-hub-e2e-"));
  const { boxRoot } = await detectBoxTarget(target);
  await scaffoldPackageRoot(boxRoot);
  await initBox(boxRoot, { branch: "main" });
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);
  // Records what box-authored schema code finds in the server's environment.
  const schemasDir = path.join(boxRoot, SCHEMAS_DIR);
  await fs.mkdir(schemasDir, { recursive: true });
  await fs.writeFile(path.join(schemasDir, "env-probe.ts"), `import { writeFileSync } from "node:fs";
import { cardSchema } from "beebox/cards";
const names = ["BBX_HUB_SECRET", "BBX_DIAG_API_KEY"];
writeFileSync(${JSON.stringify(path.join(target, SCHEMA_ENV_PROBE))}, JSON.stringify(names.filter((name) => process.env[name] !== undefined)));
export default cardSchema("env-probe", {});
`);

  return { target, boxRoot };
}

// Rebuild the CLI bundle once, up front, outside the timed readiness wait
// below — the fixture's `node_modules/beebox` symlink resolves to THIS
// checkout, so the supervisor spawns this checkout's real `bin/bbx`,
// which self-heals a stale bundle by rebuilding before running; without a
// fresh bundle here, that rebuild would eat into the supervisor's own
// readiness timeout instead of happening once, up front, on our terms.
//
// The test needs no built frontend: the traffic probe below asks the child
// for a box API route, not the SPA fallback. (It once rode the fallback,
// which made a fresh checkout run a full Vite build inside this test.)
void test("Rebuild the CLI bundle once, up front, outside the timed readiness wait below...", async (t) => {
  t.teardown(async () => {
    try {
      // The SIGTERM section above is an assertion, not a teardown: any failure before
      // it leaves this hub — and the `bbx serve` grandchild it supervises — running and
      // holding the port. One such orphan sat on 4310 for 25 minutes on 2026-08-14 and
      // made every later run in every worktree look like a regression. SIGTERM first
      // so the hub stops its own child; SIGKILL only if it will not go.
      const leftover = hubProcess;
      if (leftover !== null && leftover.pid !== undefined && pidAlive(leftover.pid)) {
        const leftoverPid = leftover.pid;
        leftover.kill("SIGTERM");
        await waitFor(() => (pidAlive(leftoverPid) ? null : true), {
          timeoutMs: BOX_KILL_GRACE_MS + 15_000,
          intervalMs: 100,
          label: "the hub to exit during cleanup",
        }).catch(() => leftover.kill("SIGKILL"));
      }
      if (fixture !== null) await fs.rm(fixture.target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      if (hubConfigPath !== null) await fs.rm(hubConfigPath, { force: true });
    } catch (error) {
      t.error(error);
    }
  });
  await execFileP("node", ["src/scripts/build-cli/build/bundle.ts"], { cwd: PACKAGE_ROOT });

  // ## The hub starts the box, `/healthz` reports it running, and traffic reaches it

  fixture = await makeFixtureBox();
  hubConfigPath = path.join(fixture.target, "..", `hub-e2e-config-${path.basename(fixture.target)}.json`);
  const requestedPort = await pickFreePort();
  await fs.writeFile(
    hubConfigPath,
    JSON.stringify({ port: requestedPort, boxes: { fixture: { path: fixture.boxRoot } } }, null, 2)
  );

  const hubBin = path.join(PACKAGE_ROOT, "bin", "bbx");
  const hub = execFile(hubBin, ["engine", "hub", "--config", hubConfigPath], { cwd: PACKAGE_ROOT });
  hubProcess = hub;
  let hubStdout = "";
  let hubStderr = "";
  let hubExited: string | null = null;
  hub.stdout?.on("data", (d) => (hubStdout += d.toString()));
  hub.stderr?.on("data", (d) => (hubStderr += d.toString()));
  hub.on("exit", (code, signal) => (hubExited = `code=${code} signal=${signal}`));

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
  t.check(hubPort, requestedPort);

  // The supervisor records why a start failed in the box's `lastError`, and
  // `/healthz` carries it. Polling only for `status === "running"` throws that
  // away and leaves a bare timeout: an unadmittable box (no Git repository, so
  // no admission gate) reported "Box maintenance requires a Git repository"
  // here for two hours while the failure read as a 120s hang against the CLI
  // build. Keep the last row and put it in the error, as the hub-exit branch
  // above does with the hub's own output.
  let lastBoxRow: BoxRow | null = null;
  const health = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${hubPort}/healthz`, diagAuth);
    const body = healthzSchema.parse(await res.json());
    const box = body.boxes.find((b) => b.slug === "fixture");
    lastBoxRow = box ?? null;
    return box && box.status === "running" ? box : null;
  }, {
    timeoutMs: STARTUP_TIMEOUT_MS,
    intervalMs: 300,
    label: () => `the fixture box to report status=running via /healthz; last row: ${JSON.stringify(lastBoxRow)}`,
  });

  t.check(health, { slug: "fixture", status: "running", consecutiveFailures: 0 });

  // `/healthz`'s per-box status is derived from supervisor state, not the raw
  // process, so read the child's own pid file to prove it's a real running
  // process — `bbx serve` writes `.bbx-serve.pid` into the box root.
  const childPid = Number((await fs.readFile(path.join(fixture.boxRoot, ".bbx-serve.pid"), "utf-8")).trim());
  t.check(childPid, any(Number).int().positive());

  // The diag-gated canary cold-starts a box and confirms it serves — the deploy's
  // child-level check. The fixture box is already running here, so `ensureRunning`
  // resolves immediately and the canary reports it ready.

  const canaryRes = await fetch(`http://127.0.0.1:${hubPort}/healthz/canary`, diagAuth);
  t.check({ status: canaryRes.status, body: canarySchema.parse(await canaryRes.json()) }, { status: 200, body: { status: "ok", slug: "fixture" } });

  // Traffic actually reaches the box through the hub (its own Fastify instance
  // serves itself at `/fixture/...`, same as standalone `bbx serve --slug`).
  // `/fixture/api/health` is a per-box route that only the child registers; the
  // hub has no route of its own there, so a `{ status, checks }` body proves the
  // request reached the CHILD process, not the hub answering on its own behalf:

  const proxied = await fetch(`http://127.0.0.1:${hubPort}/fixture/api/health`, {
    headers: { cookie: ownerCookie },
  });
  // The checks themselves depend on the machine (git-annex version, annex state), so
  // the body is pinned to its shape plus the two writability checks every box passes.
  t.check({ status: proxied.status, body: proxiedSchema.parse(await proxied.json()) }, {
    status: 200,
    body: {
      status: any(String),
      checks: containing<CheckRow>([
        { name: "inbox-writable", ok: true, message: "_content/inbox/ is writable", severity: "error" },
        { name: "git-writable", ok: true, message: ".git/objects is writable", severity: "error" },
      ]),
    },
  });

  // The authenticated request above needed the hub secret, so the child still
  // holds it. Schema code in the same process finds neither credential:

  const probe: unknown = JSON.parse(await waitFor(
    () => fs.readFile(path.join(fixture!.target, SCHEMA_ENV_PROBE), "utf-8").catch(() => null),
    { timeoutMs: 30_000, intervalMs: 100, label: "the fixture schema to record its environment" },
  ));
  t.check(probe, []);

  // ## SIGTERM kills the hub AND its child -- no orphan
  //
  // On SIGTERM the hub signals each child and waits up to `BOX_KILL_GRACE_MS`
  // for its process group to empty (a git write may be finishing) before it
  // SIGKILLs the survivors and exits. That window is the hub's contract, so the
  // wait here is the window plus margin. A fixed 5 s wait failed under load: a
  // child still finishing startup work took 6–13 s to exit, inside the contract.

  const shutdownBudgetMs = BOX_KILL_GRACE_MS + 15_000;
  hub.kill("SIGTERM");
  await waitFor(() => (hub.pid === undefined || !pidAlive(hub.pid) ? true : null), { timeoutMs: shutdownBudgetMs, intervalMs: 100, label: "the hub process to exit after SIGTERM" });
  // The hub exits only after its children are gone, so this is already true
  // unless a child escaped its process group; the short wait covers reaping.
  await waitFor(() => (pidAlive(childPid) ? null : true), { timeoutMs: 5000, intervalMs: 100, label: "the bbx serve child to exit with its hub" });

  const hubAlive = hub.pid !== undefined && pidAlive(hub.pid);
  t.check(hubAlive, false);

  t.check(pidAlive(childPid), false);
});
